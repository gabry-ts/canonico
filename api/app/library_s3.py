"""Document library on an S3-compatible store (Garage).

Garage does not implement S3 object versioning (PutBucketVersioning and ListObjectVersions answer
NotImplemented), so every version is its own object: `library/<doc>/v<N>.<ext>`, with the version
number, label, document id and upload time in user metadata. The history of a document is the
listing of its prefix.

The store is used only when CANONICO_S3_ENDPOINT and the access keys are set. When it is not
configured or not reachable, the library keeps working from the in-memory state (offline demo).
"""

import copy
import logging
import re
import threading
import time

from app import files, settings, store
from app.http import ApiError
from app.store import STORE

LOG = logging.getLogger("uvicorn.error")
KEY = re.compile(r"^(?P<doc>.+)/v(?P<n>\d+)\.(?P<ext>[a-z0-9]+)$")
_client = None


def enabled() -> bool:
    return bool(settings.env("CANONICO_S3_ENDPOINT") and settings.env("CANONICO_S3_ACCESS_KEY") and settings.env("CANONICO_S3_SECRET_KEY"))


def bucket() -> str:
    return settings.env("CANONICO_S3_BUCKET", "canonico-library")


def client():
    global _client
    if _client is None:
        import boto3
        from botocore.config import Config

        _client = boto3.client(
            "s3",
            endpoint_url=settings.env("CANONICO_S3_ENDPOINT"),
            region_name=settings.env("CANONICO_S3_REGION", "garage"),
            aws_access_key_id=settings.env("CANONICO_S3_ACCESS_KEY"),
            aws_secret_access_key=settings.env("CANONICO_S3_SECRET_KEY"),
            config=Config(s3={"addressing_style": "path"}, connect_timeout=3, read_timeout=10, retries={"max_attempts": 2}),
        )
    return _client


def object_key(doc_id: str, version: int, ext: str = "txt") -> str:
    base = doc_id if doc_id.startswith("library/") else f"library/{doc_id}"
    return f"{base}/v{version}.{ext}"


def _ext(document: dict) -> str:
    path = document.get("path") or ""
    return path.rsplit(".", 1)[1] if "." in path.rsplit("/", 1)[-1] else "txt"


def is_library(state: dict, document: dict) -> bool:
    source = state["sources"].get(document.get("source_id") or "") or {}
    return source.get("type") == "document_library" and (source.get("config") or {}).get("provider") == "s3"


def _seen(state: dict, document: dict) -> dict:
    source = state["sources"][document["source_id"]]
    return source.setdefault("x", {}).setdefault("s3_seen", {})


def _put(document: dict, entry: dict) -> tuple[str, str]:
    key = object_key(document["id"], entry["version"], _ext(document))
    meta = {
        "doc-id": document["id"],
        "version": str(entry["version"]),
        "version-of": document["id"] if entry["version"] > 1 else "",
        "version-label": entry.get("version_label") or f"v{entry['version']}",
        "uploaded-at": entry.get("uploaded_at") or store.now(),
        "date": entry.get("date") or "",
    }
    result = client().put_object(Bucket=bucket(), Key=key, Body=entry["text"].encode("utf-8"), ContentType="text/plain; charset=utf-8", Metadata=meta)
    return key, result["ETag"].strip('"')


def store_version(state: dict, document: dict, entry: dict) -> None:
    """Write a new version to the bucket before the extraction runs. Failures are logged, never raised."""
    if not enabled() or not is_library(state, document):
        return
    key = object_key(document["id"], entry["version"], _ext(document))
    seen = _seen(state, document)
    if key in seen:
        return
    try:
        key, etag = _put(document, entry)
        seen[key] = etag
    except Exception as exc:  # the in-memory library keeps the version
        LOG.warning("document library: could not store %s in the bucket: %s", key, exc)


def _objects(prefix: str) -> list[dict]:
    rows, token = [], None
    while True:
        kwargs = {"Bucket": bucket(), "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        page = client().list_objects_v2(**kwargs)
        rows += page.get("Contents", [])
        if not page.get("IsTruncated"):
            return rows
        token = page["NextContinuationToken"]


def versions(state: dict, document: dict) -> list[dict] | None:
    """The versions of a library document as listed in the bucket, or None to fall back to the state."""
    if not enabled() or not is_library(state, document):
        return None
    try:
        rows = []
        for obj in _objects(object_key(document["id"], 0).rsplit("/", 1)[0] + "/"):
            match = KEY.match(obj["Key"])
            if not match:
                continue
            meta = client().head_object(Bucket=bucket(), Key=obj["Key"]).get("Metadata", {})
            rows.append({"version": int(meta.get("version") or match["n"]), "version_label": meta.get("version-label"), "uploaded_at": meta.get("uploaded-at")})
    except Exception as exc:
        LOG.warning("document library: listing %s failed, using the state: %s", document["id"], exc)
        return None
    known = {v["version"]: v for v in document.get("versions") or []}
    current = document.get("version", 1)
    out = []
    for row in sorted(rows, key=lambda r: r["version"]):
        if row["version"] > current:
            continue
        entry = known.get(row["version"], {})
        out.append({
            "document_id": document["id"],
            "version": row["version"],
            "version_label": row["version_label"] or entry.get("version_label"),
            "uploaded_at": row["uploaded_at"] or entry.get("uploaded_at"),
            "supersedes_document_id": document["id"] if row["version"] > 1 else None,
            "facts_superseded": list(entry.get("facts_superseded", [])),
        })
    return out or None


def seed() -> int:
    """Mirror the seeded library into the bucket: upload missing versions, drop versions newer than the
    seed (left by an earlier demo run), and switch the library sources to provider `s3`. Idempotent."""
    with STORE.write() as state:
        sources = [s for s in state["sources"].values() if s["type"] == "document_library"]
        for source in sources:
            source["config"] = {**source.get("config", {}), "provider": "s3", "root_path": "library/"}
        documents = [copy.deepcopy(d) for d in state["documents"].values() if is_library(state, d)]
    uploaded, seen = 0, {}
    for document in documents:
        entries = document.get("versions") or [{"version": 1, "version_label": "v1", "uploaded_at": f"{document['date']}T00:00:00Z", "date": document["date"], "text": document["text"]}]
        wanted = {object_key(document["id"], e["version"], _ext(document)) for e in entries}
        for obj in _objects(object_key(document["id"], 0).rsplit("/", 1)[0] + "/"):
            if obj["Key"] not in wanted:
                client().delete_object(Bucket=bucket(), Key=obj["Key"])
            else:
                seen[obj["Key"]] = obj["ETag"].strip('"')
        for entry in entries:
            key = object_key(document["id"], entry["version"], _ext(document))
            if key not in seen:
                key, etag = _put(document, entry)
                seen[key] = etag
                uploaded += 1
    with STORE.write() as state:
        for source in state["sources"].values():
            if source["type"] == "document_library":
                source.setdefault("x", {})["s3_seen"] = {k: v for k, v in seen.items()}
    return uploaded


def start() -> None:
    """Seed the bucket in the background: Garage may still be starting or being initialised."""
    if not enabled():
        return

    def run():
        for attempt in range(30):
            try:
                count = seed()
                LOG.info("document library: bucket %s ready, %d versions uploaded", bucket(), count)
                return
            except Exception as exc:
                if attempt == 29:
                    LOG.warning("document library: bucket not reachable, using the in-memory library: %s", exc)
                time.sleep(3)

    threading.Thread(target=run, daemon=True).start()


def sync(source: dict) -> list[str]:
    """Ingest the objects of the bucket not seen yet (by key and ETag). Returns the documents changed."""
    try:
        return _sync(source)
    except Exception as exc:
        LOG.warning("document library: sync of %s failed: %s", source["id"], exc)
        raise ApiError(502, "The document library bucket is not reachable.") from exc


def _sync(source: dict) -> list[str]:
    from app import inbox

    prefix = (source.get("config") or {}).get("root_path") or "library/"
    found = [o for o in _objects(prefix) if KEY.match(o["Key"])]
    with STORE.read() as state:
        seen = dict(state["sources"].get(source["id"], {}).get("x", {}).get("s3_seen", {}))
    fresh = sorted((o for o in found if seen.get(o["Key"]) != o["ETag"].strip('"')), key=lambda o: (KEY.match(o["Key"])["doc"], int(KEY.match(o["Key"])["n"])))
    changed = []
    for obj in fresh:
        match = KEY.match(obj["Key"])
        response = client().get_object(Bucket=bucket(), Key=obj["Key"])
        meta = response.get("Metadata", {})
        text = files.text_of(obj["Key"], response.get("ContentType", ""), response["Body"].read())
        doc_id = meta.get("doc-id") or match["doc"]
        number = int(meta.get("version") or match["n"])
        date = meta.get("date") or store.now()[:10]
        with STORE.write() as state:
            if source["id"] not in state["sources"]:
                return changed
            state["sources"][source["id"]].setdefault("x", {}).setdefault("s3_seen", {})[obj["Key"]] = obj["ETag"].strip('"')
            document = state["documents"].get(doc_id)
            if document is None:
                title = doc_id.rsplit("/", 1)[-1].replace("-", " ").capitalize()
                state["documents"][doc_id] = {"id": doc_id, "title": title, "date": date, "path": f"{doc_id}.{match['ext']}", "text": text, "project_id": source["project_id"], "source_id": source["id"], "version": 1, "version_of": None,
                                              "versions": [{"version": 1, "version_label": meta.get("version-label") or "v1", "uploaded_at": meta.get("uploaded-at") or store.now(), "title": title, "date": date, "text": text, "facts_superseded": []}]}
                changed.append(doc_id)
            elif number > document.get("version", 1) and text.strip() != document["text"].strip():
                inbox.new_version(state, document, text=text, label=meta.get("version-label") or f"v{number}", title=None, date=date)
                changed.append(doc_id)
    return changed

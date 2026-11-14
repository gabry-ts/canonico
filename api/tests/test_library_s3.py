"""Document library on S3: unit tests on moto, an integration test on a real Garage container (marker `docker`)."""

import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest

from app import library_s3

DOC = "library/onboarding-standard"
DOC_URL = "/documents/library%2Fonboarding-standard"
Q = "What is the onboarding target for ClearPath?"
ROOT = Path(__file__).resolve().parents[2]


def _env(monkeypatch, endpoint: str | None, key: str = "GK000000000000000000000000", secret: str = "0" * 64) -> None:
    monkeypatch.setenv("CANONICO_S3_ACCESS_KEY", key)
    monkeypatch.setenv("CANONICO_S3_SECRET_KEY", secret)
    monkeypatch.setenv("CANONICO_S3_BUCKET", "canonico-library")
    if endpoint:
        monkeypatch.setenv("CANONICO_S3_ENDPOINT", endpoint)
    monkeypatch.setattr(library_s3, "_client", None)
    monkeypatch.setattr(library_s3, "start", lambda: None)


def _keys() -> list[str]:
    return sorted(o["Key"] for o in library_s3._objects("library/"))


def _flow(client):
    """Seed the bucket, upload v3 through the API, then a v4 straight into the bucket picked up by a sync."""
    assert library_s3.seed() == 3
    assert library_s3.seed() == 0
    assert _keys() == ["library/audit-handbook/v1.txt", "library/onboarding-standard/v1.txt", "library/onboarding-standard/v2.txt"]
    head = library_s3.client().head_object(Bucket="canonico-library", Key="library/onboarding-standard/v2.txt")
    assert head["Metadata"]["version"] == "2" and head["Metadata"]["version-label"] == "v2" and head["Metadata"]["version-of"] == DOC

    text = client.get(DOC_URL).json()["text"].replace("Version 2", "Version 3").replace("3–4 weeks", "5 weeks")
    result = client.post(f"{DOC_URL}/versions", json={"version_label": "v3", "text": text})
    assert result.status_code == 201, result.text
    assert "library/onboarding-standard/v3.txt" in _keys()
    body = library_s3.client().get_object(Bucket="canonico-library", Key="library/onboarding-standard/v3.txt")["Body"].read().decode()
    assert "5 weeks" in body
    assert [(v["version"], v["version_label"]) for v in client.get(f"{DOC_URL}/versions").json()] == [(1, "v1"), (2, "v2"), (3, "v3")]
    binding = client.post("/ask", json={"question": Q}).json()["binding"]
    assert "5 weeks" in binding["value"]

    v4 = text.replace("Version 3", "Version 4").replace("5 weeks", "6 weeks")
    library_s3.client().put_object(Bucket="canonico-library", Key="library/onboarding-standard/v4.txt", Body=v4.encode(), Metadata={"doc-id": DOC, "version": "4", "version-label": "v4", "date": "2026-11-14"})
    sources = client.get("/projects/proj-clearpath/sources").json()["items"]
    library = next(s for s in sources if s["type"] == "document_library")
    assert library["config"]["provider"] == "s3"
    job = client.post(f"/sources/{library['id']}/sync").json()
    for _ in range(100):
        job = client.get(f"/sync-jobs/{job['id']}").json()
        if job["status"] not in ("queued", "running"):
            break
        time.sleep(0.1)
    assert job["status"] == "done" and job["items_added"] == 1, job
    assert client.get(DOC_URL).json()["version"] == 4, job
    assert "6 weeks" in client.post("/ask", json={"question": Q}).json()["binding"]["value"]

    client.post("/demo/reset")
    assert library_s3.seed() == 0
    assert "library/onboarding-standard/v3.txt" not in _keys()
    assert [v["version"] for v in client.get(f"{DOC_URL}/versions").json()] == [1, 2]


def test_disabled_without_endpoint(client, monkeypatch):
    monkeypatch.delenv("CANONICO_S3_ENDPOINT", raising=False)
    assert not library_s3.enabled()
    assert [v["version"] for v in client.get(f"{DOC_URL}/versions").json()] == [1, 2]


def test_object_keys():
    assert library_s3.object_key(DOC, 3) == "library/onboarding-standard/v3.txt"
    assert library_s3.object_key("handbook", 1, "md") == "library/handbook/v1.md"


def test_library_on_moto(client, monkeypatch):
    moto = pytest.importorskip("moto")
    with moto.mock_aws():
        _env(monkeypatch, "http://s3.garage.test")
        monkeypatch.setattr(library_s3, "client", _moto_client)
        library_s3.client().create_bucket(Bucket="canonico-library")
        _flow(client)
    monkeypatch.setattr(library_s3, "_client", None)


_moto = {}


def _moto_client():
    import boto3

    if "c" not in _moto:
        _moto["c"] = boto3.client("s3", region_name="us-east-1", aws_access_key_id="x", aws_secret_access_key="x")
    return _moto["c"]


@pytest.fixture()
def _fresh_moto():
    _moto.clear()


test_library_on_moto = pytest.mark.usefixtures("_fresh_moto")(test_library_on_moto)


@pytest.mark.docker
def test_library_on_garage(client, monkeypatch):
    """Starts dxflrs/garage, runs deploy/garage/init.sh twice (idempotent), runs the flow, removes the container."""
    if os.environ.get("CANONICO_DOCKER_TESTS") != "1" or not shutil.which("docker"):
        pytest.skip("set CANONICO_DOCKER_TESTS=1 with a running Docker daemon")
    name = f"canonico-garage-{uuid.uuid4().hex[:8]}"
    secrets = {"GARAGE_RPC_SECRET": os.urandom(32).hex(), "GARAGE_ADMIN_TOKEN": os.urandom(24).hex(), "CANONICO_S3_ACCESS_KEY": "GK" + os.urandom(12).hex(), "CANONICO_S3_SECRET_KEY": os.urandom(32).hex()}
    env = {**os.environ, **secrets}
    run = lambda *args: subprocess.run(args, check=True, capture_output=True, text=True, env=env)  # noqa: E731
    run("docker", "network", "create", name)
    try:
        run("docker", "run", "-d", "--name", name, "--network", name, "-e", "GARAGE_RPC_SECRET", "-e", "GARAGE_ADMIN_TOKEN", "-p", "127.0.0.1::3900",
            "-v", f"{ROOT}/deploy/garage/garage.toml:/etc/garage.toml:ro", "dxflrs/garage:v1.3.1")
        init = ("docker", "run", "--rm", "--network", name, "-e", f"GARAGE_ADMIN_URL=http://{name}:3903", "-e", "GARAGE_ADMIN_TOKEN", "-e", "CANONICO_S3_ACCESS_KEY", "-e", "CANONICO_S3_SECRET_KEY",
                "-v", f"{ROOT}/deploy/garage/init.sh:/init.sh:ro", "--entrypoint", "sh", "curlimages/curl:8.11.1", "/init.sh")
        assert "garage ready" in run(*init).stdout
        assert "garage ready" in run(*init).stdout
        port = run("docker", "port", name, "3900/tcp").stdout.strip().rsplit(":", 1)[1]
        _env(monkeypatch, f"http://127.0.0.1:{port}", secrets["CANONICO_S3_ACCESS_KEY"], secrets["CANONICO_S3_SECRET_KEY"])
        for _ in range(30):
            try:
                library_s3._objects("library/")
                break
            except Exception:
                time.sleep(1)
        _flow(client)
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)
        subprocess.run(["docker", "network", "rm", name], capture_output=True)
        monkeypatch.setattr(library_s3, "_client", None)

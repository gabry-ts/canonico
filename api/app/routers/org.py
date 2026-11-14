from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app import access, github, inbox, ops, sources, store, validate
from app.http import ApiError, dump, not_found, out
from app.models import (
    Organisation,
    OrganisationPatch,
    Project,
    ProjectCreate,
    ProjectPage,
    ProjectPatch,
    Source,
    SourceCreate,
    SourcePatch,
    SyncJob,
)
from app.store import STORE

router = APIRouter()


def mail_view(config: dict | None) -> dict | None:
    if not config:
        return None
    return {k: config.get(k) for k in ("mode", "imap_host", "imap_user", "inbound_address")} | {"poll_interval_s": config.get("poll_interval_s") or 60}


def org_view(state: dict) -> dict:
    org = state["org"]
    return {"id": org["id"], "name": org["name"], "mail_config": mail_view(org.get("mail_config"))}


def project_view(state: dict, project: dict) -> dict:
    return {
        "id": project["id"],
        "name": project["name"],
        "description": project.get("description"),
        "created_at": project["created_at"],
        "mail_config_override": mail_view(project.get("mail_config_override")),
        "effective_mail_config": mail_view(inbox.effective_mail_config(state, project)),
        "source_ids": sorted(s["id"] for s in state["sources"].values() if s["project_id"] == project["id"]),
    }


def clean_mail(config) -> dict | None:
    """Settings as stored. The password is accepted on write and never kept."""
    if config is None:
        return None
    data = config.model_dump(mode="json")
    data.pop("password", None)
    data["inbound_address"] = validate.email(data.get("inbound_address"), "inbound_address")
    return data


@router.get("/org", operation_id="getOrg", status_code=200, response_model=Organisation)
def get_org():
    with STORE.read() as state:
        return out(Organisation, org_view(state))


@router.patch("/org", operation_id="patchOrg", status_code=200, response_model=Organisation)
def patch_org(body: OrganisationPatch, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "manage_members")
        if body.name:
            state["org"]["name"] = body.name
        return out(Organisation, org_view(state))


@router.get("/projects", operation_id="listProjects", status_code=200, response_model=ProjectPage)
def list_projects(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    with STORE.read() as state:
        items = [project_view(state, p) for p in sorted(state["projects"].values(), key=lambda p: (p["created_at"], p["id"]))]
    return out(ProjectPage, {"items": items[offset : offset + limit], "total": len(items), "limit": limit, "offset": offset})


@router.post("/projects", operation_id="createProject", status_code=201, response_model=Project)
def create_project(body: ProjectCreate, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "manage_sources")
        project_id = body.id or "proj-" + store.slugify(body.name)
        if project_id in state["projects"]:
            raise ApiError(409, f"Project {project_id} already exists.")
        state["projects"][project_id] = {
            "id": project_id,
            "name": body.name,
            "description": body.description,
            "created_at": store.now(),
            "mail_config_override": clean_mail(body.mail_config_override),
        }
        return out(Project, project_view(state, state["projects"][project_id]), 201)


@router.get("/projects/{project_id}", operation_id="getProject", status_code=200, response_model=Project)
def get_project(project_id: str):
    with STORE.read() as state:
        return out(Project, project_view(state, ops.require_project(state, project_id)))


@router.patch("/projects/{project_id}", operation_id="patchProject", status_code=200, response_model=Project)
def patch_project(project_id: str, body: ProjectPatch, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        project = ops.require_project(state, project_id)
        access.allow(state, demo_actor, "manage_sources", project_id)
        changes = body.model_dump(exclude_unset=True)
        if changes.get("name"):
            project["name"] = changes["name"]
        if "description" in changes:
            project["description"] = changes["description"]
        return out(Project, project_view(state, project))


@router.delete("/projects/{project_id}", operation_id="deleteProject", status_code=200, response_model=None)
def delete_project(project_id: str, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        ops.require_project(state, project_id)
        access.allow(state, demo_actor, "manage_sources", project_id)
        sources.delete_project(state, project_id)
    return JSONResponse({"id": project_id, "deleted": True})


@router.get("/projects/{project_id}/sources", operation_id="listSources", status_code=200, response_model=None)
def list_sources(project_id: str):
    with STORE.read() as state:
        ops.require_project(state, project_id)
        items = [sources.view(state, s) for s in state["sources"].values() if s["project_id"] == project_id]
        return JSONResponse({"items": dump(list[Source], items)})


@router.post("/projects/{project_id}/sources", operation_id="createSource", status_code=201, response_model=Source)
def create_source(project_id: str, body: SourceCreate, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        ops.require_project(state, project_id)
        access.allow(state, demo_actor, "manage_sources", project_id)
        kind = body.type.value
        config = sources.check_config(kind, body.config.model_dump(mode="json", exclude_none=True) if body.config else {})
        for existing in state["sources"].values():
            if existing["project_id"] == project_id and existing["type"] == kind and (existing.get("config") or {}) == config and kind != "documents":
                raise ApiError(409, f"Source {existing['id']} already uses these settings.")
        source_id = sources.new_id(state, project_id, kind)
        state["sources"][source_id] = {"id": source_id, "project_id": project_id, "type": kind, "label": body.label, "status": "idle", "last_synced_at": None, "config": config, "x": {}}
        if kind == "webhook":
            from app import items

            issued = items.rotate(state["sources"][source_id]["x"], "secret")
            view = dump(Source, sources.view(state, state["sources"][source_id]))
            return JSONResponse({**view, "secret": issued["secret"]}, status_code=201)
        return out(Source, sources.view(state, state["sources"][source_id]), 201)


@router.get("/sources/{source_id}", operation_id="getSource", status_code=200, response_model=Source)
def get_source(source_id: str):
    with STORE.read() as state:
        return out(Source, sources.view(state, sources.require(state, source_id)))


@router.patch("/sources/{source_id}", operation_id="patchSource", status_code=200, response_model=Source)
def patch_source(source_id: str, body: SourcePatch, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        source = sources.require(state, source_id)
        access.allow(state, demo_actor, "manage_sources", source["project_id"])
        if body.label:
            source["label"] = body.label
        if body.config is not None:
            source["config"] = sources.check_config(source["type"], body.config.model_dump(mode="json", exclude_none=True))
        return out(Source, sources.view(state, source))


@router.delete("/sources/{source_id}", operation_id="deleteSource", status_code=200, response_model=None)
def delete_source(source_id: str, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        source = sources.require(state, source_id)
        access.allow(state, demo_actor, "manage_sources", source["project_id"])
        if source.get("status") == "syncing":
            raise ApiError(409, f"Source {source_id} is syncing.")
        for document in state["documents"].values():
            if document.get("source_id") == source_id:
                document["source_id"] = None
        del state["sources"][source_id]
    return JSONResponse({"id": source_id, "deleted": True})


@router.post("/sources/{source_id}/sync", operation_id="syncSource", status_code=202, response_model=SyncJob)
def sync_source(source_id: str, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        source = sources.require(state, source_id)
        access.allow(state, demo_actor, "manage_sources", source["project_id"])
        job = sources.start_sync(state, source)
        view = sources.job_view(job)
    sources.launch(job["id"])
    return out(SyncJob, view, 202)


@router.get("/sync-jobs/{job_id}", operation_id="getSyncJob", status_code=200, response_model=SyncJob)
def get_sync_job(job_id: str):
    with STORE.read() as state:
        job = next((j for j in state["sync_jobs"] if j["id"] == job_id), None)
        if job is None:
            raise not_found(f"Sync job {job_id}")
        return out(SyncJob, sources.job_view(job))


@router.get("/sources/{source_id}/documents", operation_id="listSourceDocuments", status_code=200, response_model=None)
def list_source_documents(source_id: str, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    """Documents of a source, newest first. A versioned document is one row at its current version."""
    from app.models import Document
    from app.routers.documents import doc_view

    with STORE.read() as state:
        sources.require(state, source_id)
        rows = [doc_view(state, d) for d in state["documents"].values() if d.get("source_id") == source_id]
    rows.sort(key=lambda d: (d["date"], d["id"]), reverse=True)
    return JSONResponse(dump(list[Document], rows[offset : offset + limit]))


@router.post("/sources/github/preview", operation_id="previewGithubSource", status_code=200, response_model=None)
def preview_github_source(body: dict):
    """Look up a public repository before adding it as a source."""
    from app.models import GithubPreview

    url = str((body or {}).get("repo_url") or "")
    try:
        owner, repo = github.parse_repo(url)
    except github.GithubError as exc:
        raise ApiError(422, f"repo_url: {exc}") from exc
    with STORE.read() as state:
        offline = bool(state["config"].get("offline_mode"))
    try:
        preview = github.preview(owner, repo, offline)
    except github.GithubError as exc:
        reason = str(exc)
        if reason in ("repository not found or not public", "not public", "only public repositories are supported"):
            raise ApiError(404, f"Repository {owner}/{repo} was not found or is not public.") from exc
        raise ApiError(422, f"Repository {owner}/{repo} could not be looked up: {reason}.") from exc
    return out(GithubPreview, preview)

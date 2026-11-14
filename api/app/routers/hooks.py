import json

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app import access, files, items, ops, settings, sources, store
from app.http import ApiError, dump, not_found, out
from app.models import InboundItem, InboundItemResult, ItemDetail, ItemPage, OrgHookConfig, RotateSecretResult, TagCount, TagRule, TagRuleCreate, TagRulePatch, TagRuleTestResult
from app.store import STORE

router = APIRouter()
UNAUTHORIZED = ApiError(401, "Invalid X-Canonico-Token.", "unauthorized")


def item_dict(body: InboundItem) -> dict:
    return body.model_dump(mode="json", exclude_none=True)


def finish(result: dict) -> JSONResponse:
    """When the rule found nothing in a new item, let the model read it (never offline), then answer 202."""
    if not result["duplicate"] and not result["facts_created"]:
        extra = sources.enrich_document(result["document_id"])
        if extra:
            result["facts_created"] = extra
            with STORE.write() as state:
                stored = next((i for i in state["items"] if i["id"] == result["item_id"]), None)
                if stored is not None:
                    stored["fact_ids"] = list(extra)
                    stored["result"] = {**result}
    return out(InboundItemResult, result, 202)


def rule_view(rule: dict) -> dict:
    return {k: rule[k] for k in ("id", "tag", "project_id", "priority")}


def _project_hook(state: dict, project_id: str, token: str | None) -> dict:
    ops.require_project(state, project_id)
    source = next((s for s in state["sources"].values() if s["project_id"] == project_id and s["type"] == "webhook" and items.token_matches(s["x"].get("secret"), token)), None)
    if source is None:
        raise UNAUTHORIZED
    return source


@router.post("/hooks/projects/{project_id}", operation_id="receiveProjectHook", status_code=202, response_model=InboundItemResult)
def receive_project_hook(project_id: str, body: InboundItem, x_canonico_token: str | None = Header(None)):
    with STORE.read() as state:
        _project_hook(state, project_id, x_canonico_token)
    item = files.with_linked_text(item_dict(body))
    with STORE.write() as state:
        source = _project_hook(state, project_id, x_canonico_token)
        result = items.receive(state, project_id, item, routed_by="url", rule_id=None, source=source, actor="webhook")
    return finish(result)


def _org_route(state: dict, item: dict, token: str | None) -> tuple[str, str, str | None]:
    if not items.token_matches(state["hooks"].get("org"), token):
        raise UNAUTHORIZED
    if item.get("project_id"):
        return ops.require_project(state, item["project_id"])["id"], "project_id", None
    rule = items.route_by_tags(state, item.get("tags") or [])
    if rule is None:
        raise ApiError(422, "No project_id and no tag rule matched the item.", "unroutable")
    return rule["project_id"], "tag_rule", rule["id"]


@router.post("/hooks/org", operation_id="receiveOrgHook", status_code=202, response_model=InboundItemResult)
def receive_org_hook(body: InboundItem, x_canonico_token: str | None = Header(None)):
    item = item_dict(body)
    with STORE.read() as state:
        _org_route(state, item, x_canonico_token)
    item = files.with_linked_text(item)
    with STORE.write() as state:
        project_id, routed_by, rule_id = _org_route(state, item, x_canonico_token)
        result = items.receive(state, project_id, item, routed_by=routed_by, rule_id=rule_id, source=items.webhook_source(state, project_id), actor="webhook")
    return finish(result)


@router.get("/org/hooks", operation_id="getOrgHooks", status_code=200, response_model=OrgHookConfig)
def get_org_hooks():
    with STORE.read() as state:
        record = state["hooks"]["org"]
        return out(OrgHookConfig, {"url": f"{settings.public_url()}/hooks/org", "secret_last4": record["last4"], "created_at": record["created_at"]})


@router.post("/org/hooks/rotate-secret", operation_id="rotateOrgHookSecret", status_code=200, response_model=RotateSecretResult)
def rotate_org_hook_secret(demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "manage_sources")
        return out(RotateSecretResult, items.rotate(state["hooks"], "org"))


@router.post("/sources/{source_id}/rotate-secret", operation_id="rotateSourceSecret", status_code=200, response_model=RotateSecretResult)
def rotate_source_secret(source_id: str, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        source = sources.require(state, source_id)
        access.allow(state, demo_actor, "manage_sources", source["project_id"])
        if source["type"] != "webhook":
            raise ApiError(409, f"Source {source_id} is not a webhook source.")
        return out(RotateSecretResult, items.rotate(source["x"], "secret"))


@router.get("/org/tag-rules", operation_id="listTagRules", status_code=200, response_model=None)
def list_tag_rules():
    with STORE.read() as state:
        rules = sorted(state["tag_rules"].values(), key=lambda r: (r["priority"], r["id"]))
        return JSONResponse({"items": dump(list[TagRule], [rule_view(r) for r in rules])})


@router.post("/org/tag-rules", operation_id="createTagRule", status_code=201, response_model=TagRule)
def create_tag_rule(body: TagRuleCreate, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "manage_sources")
        ops.require_project(state, body.project_id)
        tag = body.tag.strip()
        if not tag:
            raise ApiError(422, "tag: must not be empty")
        for rule in state["tag_rules"].values():
            if rule["tag"].lower() == tag.lower():
                raise ApiError(409, f"Rule {rule['id']} already routes the tag {tag}.")
        state["seq"]["tag_rule"] = state["seq"].get("tag_rule", 0) + 1
        rule_id = f"tr-{state['seq']['tag_rule']:03d}"
        state["tag_rules"][rule_id] = {"id": rule_id, "tag": tag, "project_id": body.project_id, "priority": 100 if body.priority is None else body.priority}
        return out(TagRule, rule_view(state["tag_rules"][rule_id]), 201)


@router.post("/org/tag-rules/test", operation_id="testTagRules", status_code=200, response_model=TagRuleTestResult)
def test_tag_rules(body: dict):
    tags = (body or {}).get("tags")
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        raise ApiError(422, "tags: a list of strings is required")
    with STORE.read() as state:
        rule = items.route_by_tags(state, tags)
        return out(TagRuleTestResult, {"project_id": rule["project_id"] if rule else None, "rule_id": rule["id"] if rule else None})


@router.patch("/org/tag-rules/{rule_id}", operation_id="patchTagRule", status_code=200, response_model=TagRule)
def patch_tag_rule(rule_id: str, body: TagRulePatch, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "manage_sources")
        rule = state["tag_rules"].get(rule_id)
        if rule is None:
            raise not_found(f"Tag rule {rule_id}")
        changes = body.model_dump(mode="json", exclude_unset=True, exclude_none=True)
        if "project_id" in changes:
            ops.require_project(state, changes["project_id"])
        rule.update(changes)
        return out(TagRule, rule_view(rule))


@router.delete("/org/tag-rules/{rule_id}", operation_id="deleteTagRule", status_code=200, response_model=None)
def delete_tag_rule(rule_id: str, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "manage_sources")
        if rule_id not in state["tag_rules"]:
            raise not_found(f"Tag rule {rule_id}")
        del state["tag_rules"][rule_id]
    return JSONResponse({"id": rule_id, "deleted": True})


async def _parse_upload(request: Request) -> dict:
    try:
        if request.headers.get("content-type", "").startswith("multipart/form-data"):
            form = await request.form()
            upload, metadata = form.get("file"), form.get("metadata")
            if upload is None or not hasattr(upload, "read") or not isinstance(metadata, str):
                raise ApiError(422, "file and metadata: both parts are required")
            try:
                fields = json.loads(metadata)
            except ValueError as exc:
                raise ApiError(422, "metadata: not valid JSON") from exc
            text = files.text_of(getattr(upload, "filename", "") or "", getattr(upload, "content_type", "") or "", await upload.read())
            return item_dict(InboundItem.model_validate({**fields, "text": text}))
        try:
            payload = json.loads(await request.body() or b"")
        except ValueError as exc:
            raise ApiError(400, "Malformed JSON body.") from exc
        return item_dict(InboundItem.model_validate(payload))
    except ValidationError as exc:
        parts = [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()]
        raise ApiError(422, "; ".join(parts)) from exc


@router.post("/projects/{project_id}/items", operation_id="uploadProjectItem", status_code=202, response_model=InboundItemResult)
async def upload_project_item(project_id: str, request: Request, demo_actor: str | None = access.Actor):
    with STORE.read() as state:
        ops.require_project(state, project_id)
        access.allow(state, demo_actor, "correct_fact", project_id)
        member = access.find_member(state, demo_actor) or access.default_member(state)
        actor = (member or {}).get("display_name") or (member or {}).get("name") or "anonymous"
    item = files.with_linked_text(await _parse_upload(request))
    with STORE.write() as state:
        ops.require_project(state, project_id)
        result = items.receive(state, project_id, item, routed_by="project_id", rule_id=None, source=None, actor=actor)
    return finish(result)


@router.get("/projects/{project_id}/items", operation_id="listProjectItems", status_code=200, response_model=ItemPage)
def list_project_items(project_id: str, type: str | None = None, tag: str | None = None, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    with STORE.read() as state:
        ops.require_project(state, project_id)
        rows = [items.item_view(state, i) for i in reversed(state["items"]) if i["project_id"] == project_id]
    if type:
        rows = [r for r in rows if r["type"] == type]
    if tag:
        rows = [r for r in rows if tag in r["tags"]]
    return out(ItemPage, {"items": rows[offset : offset + limit], "total": len(rows), "limit": limit, "offset": offset})


@router.get("/items/{item_id}", operation_id="getItem", status_code=200, response_model=ItemDetail)
def get_item(item_id: str):
    with STORE.read() as state:
        item = next((i for i in state["items"] if i["id"] == item_id), None)
        if item is None:
            raise not_found(f"Item {item_id}")
        return out(ItemDetail, {**items.item_view(state, item), "text_excerpt": item.get("excerpt", "")})


@router.get("/tags", operation_id="listTags", status_code=200, response_model=list[TagCount])
def list_tags(project_id: str | None = None):
    with STORE.read() as state:
        return out(list[TagCount], items.tag_counts(state, ops.scope(state, project_id)))

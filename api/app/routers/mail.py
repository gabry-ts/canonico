from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app import access, imap_client, inbox, ops, settings, sources, store, validate
from app.http import ApiError, dump, not_found, out
from app.models import (
    InboundEmail,
    InboundEmailResult,
    MailConfig,
    MailConfigWrite,
    MailPollRequest,
    MailPollResult,
    MailRule,
    MailRuleCreate,
    MailRulePatch,
    MessagePage,
    ProjectMail,
    RuleTestResult,
)
from app.routers.org import clean_mail, mail_view
from app.store import STORE

router = APIRouter()


def project_mail(state: dict, project: dict) -> dict:
    override = project.get("mail_config_override")
    effective = mail_view(inbox.effective_mail_config(state, project)) or {"mode": "webhook", "imap_host": None, "imap_user": None, "inbound_address": None, "poll_interval_s": 60}
    return {"project_id": project["id"], "overridden": bool(override), "effective_mail_config": effective, "mail_config_override": mail_view(override)}


def rule_view(rule: dict) -> dict:
    return {k: rule[k] for k in ("id", "match_type", "value", "project_id", "priority")}


def email_dict(body: InboundEmail) -> dict:
    return body.model_dump(mode="json", by_alias=True, exclude_none=True)


def real_mailbox() -> dict | None:
    """The real mailbox the server is configured for (CANONICO_IMAP_HOST), offered as mode `imap`. Never a secret."""
    host = settings.env("CANONICO_IMAP_HOST").strip()
    return {"host": host, "user": settings.env("CANONICO_IMAP_USER").strip() or None} if host else None


def org_mail_view(config: dict | None) -> dict:
    view = mail_view(config) or {"mode": "webhook", "imap_host": None, "imap_user": None, "inbound_address": None, "poll_interval_s": 60}
    return {**view, "real_mailbox": real_mailbox()}


def check_mode(body: MailConfigWrite) -> None:
    if body.mode.value == "imap" and real_mailbox() is None:
        raise ApiError(422, "mode: this server has no real mailbox (CANONICO_IMAP_HOST is not set). Use imap_mock or webhook.")


@router.get("/org/mail", operation_id="getOrgMail", status_code=200, response_model=MailConfig)
def get_org_mail():
    with STORE.read() as state:
        return out(MailConfig, org_mail_view(state["org"].get("mail_config")))


@router.put("/org/mail", operation_id="putOrgMail", status_code=200, response_model=MailConfig)
def put_org_mail(body: MailConfigWrite, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "manage_mail", None)
        check_mode(body)
        state["org"]["mail_config"] = clean_mail(body)
        return out(MailConfig, org_mail_view(state["org"]["mail_config"]))


@router.get("/projects/{project_id}/mail", operation_id="getProjectMail", status_code=200, response_model=ProjectMail)
def get_project_mail(project_id: str):
    with STORE.read() as state:
        return out(ProjectMail, project_mail(state, ops.require_project(state, project_id)))


@router.put("/projects/{project_id}/mail", operation_id="putProjectMail", status_code=200, response_model=ProjectMail)
def put_project_mail(project_id: str, body: MailConfigWrite, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "manage_mail", project_id)
        project = ops.require_project(state, project_id)
        check_mode(body)
        project["mail_config_override"] = clean_mail(body)
        return out(ProjectMail, project_mail(state, project))


@router.delete("/projects/{project_id}/mail", operation_id="deleteProjectMail", status_code=200, response_model=ProjectMail)
def delete_project_mail(project_id: str, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "manage_mail", project_id)
        project = ops.require_project(state, project_id)
        project["mail_config_override"] = None
        return out(ProjectMail, project_mail(state, project))


@router.get("/org/mail/rules", operation_id="listMailRules", status_code=200, response_model=None)
def list_mail_rules():
    with STORE.read() as state:
        rules = sorted(state["mail_rules"].values(), key=lambda r: (r["priority"], r["id"]))
        return JSONResponse({"items": dump(list[MailRule], [rule_view(r) for r in rules])})


@router.post("/org/mail/rules", operation_id="createMailRule", status_code=201, response_model=MailRule)
def create_mail_rule(body: MailRuleCreate, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "manage_mail", None)
        ops.require_project(state, body.project_id)
        value = validate.rule_value(body.match_type.value, body.value)
        for rule in state["mail_rules"].values():
            if rule["match_type"] == body.match_type.value and rule["value"].lower() == value.lower():
                raise ApiError(409, f"Rule {rule['id']} already matches {body.match_type.value} {value}.")
        state["seq"]["rule"] = state["seq"].get("rule", 0) + 1
        rule_id = f"rule-{state['seq']['rule']:03d}"
        state["mail_rules"][rule_id] = {"id": rule_id, "match_type": body.match_type.value, "value": value, "project_id": body.project_id, "priority": 100 if body.priority is None else body.priority}
        return out(MailRule, rule_view(state["mail_rules"][rule_id]), 201)


@router.post("/org/mail/rules/test", operation_id="testMailRules", status_code=200, response_model=RuleTestResult)
def test_mail_rules(body: InboundEmail):
    with STORE.read() as state:
        rule, reason = inbox.route(state, email_dict(body))
        return out(RuleTestResult, {"matched": rule is not None, "routed_project_id": rule["project_id"] if rule else None, "rule_id": rule["id"] if rule else None, "reason": reason})


@router.patch("/org/mail/rules/{rule_id}", operation_id="patchMailRule", status_code=200, response_model=MailRule)
def patch_mail_rule(rule_id: str, body: MailRulePatch, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "manage_mail", None)
        rule = state["mail_rules"].get(rule_id)
        if rule is None:
            raise not_found(f"Mail rule {rule_id}")
        changes = body.model_dump(mode="json", exclude_unset=True, exclude_none=True)
        if "project_id" in changes:
            ops.require_project(state, changes["project_id"])
        if "value" in changes or "match_type" in changes:
            changes["value"] = validate.rule_value(changes.get("match_type", rule["match_type"]), changes.get("value", rule["value"]))
            for other in state["mail_rules"].values():
                if other is not rule and other["match_type"] == changes.get("match_type", rule["match_type"]) and other["value"].lower() == changes["value"].lower():
                    raise ApiError(409, f"Rule {other['id']} already matches {other['match_type']} {other['value']}.")
        rule.update(changes)
        return out(MailRule, rule_view(rule))


@router.delete("/org/mail/rules/{rule_id}", operation_id="deleteMailRule", status_code=200, response_model=None)
def delete_mail_rule(rule_id: str, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "manage_mail", None)
        if rule_id not in state["mail_rules"]:
            raise not_found(f"Mail rule {rule_id}")
        del state["mail_rules"][rule_id]
    return JSONResponse({"id": rule_id, "deleted": True})


def with_model_facts(result: dict) -> dict:
    """When the deterministic rule found nothing in an email, let the model read it (never in offline mode)."""
    if not result["facts_created"] and result["routed_project_id"]:
        result["facts_created"] = sources.enrich_document(result["document_id"], prefix="E")
    return result


@router.post("/mail/inbound", operation_id="receiveInboundEmail", status_code=200, response_model=InboundEmailResult)
def receive_inbound_email(body: InboundEmail, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "correct_fact")
        result = inbox.receive(state, email_dict(body))
    return out(InboundEmailResult, with_model_facts(result))


@router.post("/mail/poll", operation_id="pollMail", status_code=200, response_model=MailPollResult)
def poll_mail(body: MailPollRequest | None = None, demo_actor: str | None = access.Actor):
    project_id = body.project_id if body else None
    with STORE.read() as state:
        if project_id is not None:
            ops.require_project(state, project_id)
        access.allow(state, demo_actor, "correct_fact", project_id)
        real = imap_client.active(state, project_id)
    if real:
        result = imap_client.poll(project_id)
    else:
        with STORE.write() as state:
            result = inbox.poll(state, project_id)
    result["results"] = [with_model_facts(item) for item in result["results"]]
    return out(MailPollResult, result)


@router.get("/projects/{project_id}/messages", operation_id="listProjectMessages", status_code=200, response_model=MessagePage)
def list_project_messages(project_id: str, limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    with STORE.read() as state:
        ops.require_project(state, project_id)
        items = [m for m in state["messages"] if m.get("project_id") == project_id]
        items.sort(key=lambda m: m["date"], reverse=True)
        return out(MessagePage, {"items": items[offset : offset + limit], "total": len(items), "limit": limit, "offset": offset})


@router.post("/demo/send-email", operation_id="demoSendEmail", status_code=200, response_model=InboundEmailResult)
def demo_send_email(demo_actor: str | None = access.Actor):
    """Canned client email of the live demo. Deterministic, no model call. With a real mailbox it goes through SMTP and IMAP."""
    with STORE.read() as state:
        access.allow(state, demo_actor, "correct_fact")
        real = imap_client.active(state, None)
    if real:
        return out(InboundEmailResult, imap_client.demo_send(inbox.DEMO_EMAIL))
    with STORE.write() as state:
        email = {**inbox.DEMO_EMAIL, "date": store.now()}
        return out(InboundEmailResult, inbox.receive(state, email))

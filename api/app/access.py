"""Demo identity and roles. There is no real authentication: the actor is picked with a header."""

from fastapi import Header, Query

from app.http import ApiError, not_found
from app.store import STORE

PERMISSIONS = {
    "viewer": ["ask", "read_facts"],
    "editor": ["ask", "read_facts", "retire_fact", "restore_fact", "correct_fact", "resolve_conflict"],
    "admin": ["ask", "read_facts", "retire_fact", "restore_fact", "correct_fact", "resolve_conflict", "manage_sources", "manage_mail", "manage_members"],
    "owner": ["ask", "read_facts", "retire_fact", "restore_fact", "correct_fact", "resolve_conflict", "manage_sources", "manage_mail", "manage_members", "admin_demo"],
}
ROLE_ORDER = ["viewer", "editor", "admin", "owner"]


def default_member(state: dict) -> dict | None:
    members = sorted(state["members"].values(), key=lambda m: (ROLE_ORDER.index(m["org_role"]) * -1, m["created_at"], m["id"]))
    return members[0] if members else None


def find_member(state: dict, actor: str | None) -> dict | None:
    """Member named by the demo actor value: an id, a full name, a first name or an email."""
    if not actor:
        return default_member(state)
    wanted = actor.strip().lower()
    for member in state["members"].values():
        names = {member["id"].lower(), member["name"].lower(), member["name"].split()[0].lower(), member["email"].lower(), (member.get("display_name") or "").lower()}
        if wanted in names:
            return member
    return None


def project_role(state: dict, member: dict, project_id: str | None) -> tuple[str, bool]:
    """Role of a member in a project and whether it is inherited from the organisation."""
    if project_id is not None:
        for entry in state["project_members"]:
            if entry["member_id"] == member["id"] and entry["project_id"] == project_id:
                return entry["role"], False
    return member["org_role"], True


def member_view(member: dict) -> dict:
    return {k: member[k] for k in ("id", "name", "email", "org_role", "created_at", "status")}


def me_view(state: dict, member: dict, project_id: str | None) -> dict:
    role, _ = project_role(state, member, project_id)
    return {
        "member": member_view(member),
        "role": role,
        "permissions": PERMISSIONS[role],
        "name": member.get("display_name") or member["name"].split()[0],
        "title": member.get("title"),
    }


def actor_of(state: dict, header: str | None, query: str | None) -> dict | None:
    actor = header or query
    member = find_member(state, actor)
    if actor and member is None:
        raise not_found(f"Member {actor}")
    return member


def require(permission: str):
    """Dependency: 403 when the demo actor lacks a permission. Without an actor the owner acts, so the demo never breaks."""

    def check(x_demo_actor: str | None = Header(None), actor: str | None = Query(None, alias="demo_actor"), project_id: str | None = Query(None)) -> None:
        with STORE.read() as state:
            member = find_member(state, x_demo_actor or actor) if (x_demo_actor or actor) else default_member(state)
            if member is None:
                return
            role, _ = project_role(state, member, project_id if project_id in state["projects"] else None)
            if permission not in PERMISSIONS[role]:
                raise ApiError(403, f"{member['name']} ({role}) is not allowed to {permission.replace('_', ' ')}.", "forbidden")

    return check

from fastapi import APIRouter, Header, Query, Request, Response
from fastapi.responses import JSONResponse

from app import access, auth, ops, store
from app.http import ApiError, dump, not_found, out
from app.models import Me, Member, MemberCreate, MemberPage, MemberPatch, Organisation, OrgSetupRequest, ProjectMember, ProjectMemberSet, RolePermissions, SetupStatus
from app.routers.org import clean_mail, org_view
from app.store import STORE

router = APIRouter()


def require_member(state: dict, member_id: str) -> dict:
    member = state["members"].get(member_id)
    if member is None:
        raise not_found(f"Member {member_id}")
    return member


def project_member_view(state: dict, member: dict, project_id: str) -> dict:
    role, inherited = access.project_role(state, member, project_id)
    return {"member_id": member["id"], "project_id": project_id, "role": role, "inherited": inherited}


def owners(state: dict) -> list[dict]:
    return [m for m in state["members"].values() if m["org_role"] == "owner"]


@router.get("/me", operation_id="getMe", status_code=200, response_model=Me)
def get_me(request: Request, x_demo_actor: str | None = Header(None), actor: str | None = None, project_id: str | None = None):
    """Who is acting. `name` and `title` are added for the page header, `session_expires_at` says whether a
    sign-in session (cookie or bearer) is behind it."""
    with STORE.read() as state:
        if project_id is not None:
            ops.require_project(state, project_id)
        member = access.actor_of(state, x_demo_actor, actor)
        if member is None:
            raise not_found("Member")
        view = access.me_view(state, member, project_id)
    view["session_expires_at"] = auth.session_expiry(request)
    return JSONResponse({**dump(Me, view), "name": view["name"], "title": view["title"]})


@router.get("/roles", operation_id="listRoles", status_code=200, response_model=list[RolePermissions])
def list_roles():
    return out(list[RolePermissions], [{"role": role, "permissions": access.PERMISSIONS[role]} for role in access.ROLE_ORDER])


@router.get("/org/members", operation_id="listOrgMembers", status_code=200, response_model=MemberPage)
def list_org_members(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    with STORE.read() as state:
        members = sorted(state["members"].values(), key=lambda m: (m["created_at"], m["id"]))
        return out(MemberPage, {"total": len(members), "items": [access.member_view(m) for m in members[offset : offset + limit]]})


@router.post("/org/members", operation_id="inviteOrgMember", status_code=201, response_model=Member)
def invite_org_member(body: MemberCreate, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "manage_members")
        member_id = "mem-" + store.slugify(body.name)
        email = str(body.email).strip().lower()
        if member_id in state["members"] or any(m["email"].lower() == email for m in state["members"].values()):
            raise ApiError(409, f"A member with this name or email already exists ({member_id}).")
        state["members"][member_id] = {
            "id": member_id,
            "name": body.name,
            "display_name": body.name.split()[0] if body.name.split() else body.name,
            "title": None,
            "email": email,
            "org_role": body.org_role.value,
            "created_at": store.now(),
            "status": "invited",
        }
        return out(Member, access.member_view(state["members"][member_id]), 201)


@router.get("/org/members/{member_id}", operation_id="getOrgMember", status_code=200, response_model=Member)
def get_org_member(member_id: str):
    with STORE.read() as state:
        return out(Member, access.member_view(require_member(state, member_id)))


@router.patch("/org/members/{member_id}", operation_id="patchOrgMember", status_code=200, response_model=Member)
def patch_org_member(member_id: str, body: MemberPatch, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "manage_members")
        member = require_member(state, member_id)
        changes = body.model_dump(mode="json", exclude_unset=True, exclude_none=True)
        if "email" in changes:
            email = str(changes["email"]).strip().lower()
            if any(m is not member and m["email"].lower() == email for m in state["members"].values()):
                raise ApiError(409, "Another member already uses this email.")
            member["email"] = email
        if "org_role" in changes and changes["org_role"] != member["org_role"]:
            if member["org_role"] == "owner" and len(owners(state)) == 1:
                raise ApiError(409, "The last owner cannot change role.")
            member["org_role"] = changes["org_role"]
        if changes.get("name"):
            member["name"] = changes["name"]
            member["display_name"] = changes["name"].split()[0]
        return out(Member, access.member_view(member))


@router.delete("/org/members/{member_id}", operation_id="deleteOrgMember", status_code=204, response_model=None)
def delete_org_member(member_id: str, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        access.allow(state, demo_actor, "manage_members")
        member = require_member(state, member_id)
        if member["org_role"] == "owner" and len(owners(state)) == 1:
            raise ApiError(409, "The last owner cannot be removed.")
        del state["members"][member_id]
        state["project_members"] = [e for e in state["project_members"] if e["member_id"] != member_id]
    # A removed member is signed out everywhere at once.
    auth.revoke_member(member_id)
    return Response(status_code=204)


@router.get("/projects/{project_id}/members", operation_id="listProjectMembers", status_code=200, response_model=list[ProjectMember])
def list_project_members(project_id: str):
    with STORE.read() as state:
        ops.require_project(state, project_id)
        members = sorted(state["members"].values(), key=lambda m: (m["created_at"], m["id"]))
        return out(list[ProjectMember], [project_member_view(state, m, project_id) for m in members])


@router.put("/projects/{project_id}/members/{member_id}", operation_id="setProjectMemberRole", status_code=200, response_model=ProjectMember)
def set_project_member_role(project_id: str, member_id: str, body: ProjectMemberSet, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        ops.require_project(state, project_id)
        access.allow(state, demo_actor, "manage_members")
        member = require_member(state, member_id)
        if body.member_id != member_id:
            raise ApiError(422, "member_id: does not match the member in the path.")
        state["project_members"] = [e for e in state["project_members"] if not (e["member_id"] == member_id and e["project_id"] == project_id)]
        state["project_members"].append({"member_id": member_id, "project_id": project_id, "role": body.role.value})
        return out(ProjectMember, project_member_view(state, member, project_id))


@router.delete("/projects/{project_id}/members/{member_id}", operation_id="clearProjectMemberRole", status_code=200, response_model=ProjectMember)
def clear_project_member_role(project_id: str, member_id: str, demo_actor: str | None = access.Actor):
    with STORE.write() as state:
        ops.require_project(state, project_id)
        access.allow(state, demo_actor, "manage_members")
        member = require_member(state, member_id)
        state["project_members"] = [e for e in state["project_members"] if not (e["member_id"] == member_id and e["project_id"] == project_id)]
        return out(ProjectMember, project_member_view(state, member, project_id))


@router.post("/org/setup", operation_id="setupOrg", status_code=201, response_model=Organisation)
def setup_org(body: OrgSetupRequest):
    """First-run setup. Refused once the organisation has an owner."""
    with STORE.write() as state:
        if owners(state):
            raise ApiError(409, "The organisation is already set up.")
        state["org"]["name"] = body.organisation_name
        state["org"]["primary_email_domain"] = body.primary_email_domain
        if body.mail_config is not None:
            state["org"]["mail_config"] = clean_mail(body.mail_config)
        elif not state["org"].get("mail_config"):
            state["org"]["mail_config"] = {"mode": "webhook", "imap_host": None, "imap_user": None, "inbound_address": f"brain@inbound.{body.primary_email_domain}", "poll_interval_s": 60}
        member_id = "mem-" + store.slugify(body.first_admin.name)
        state["members"][member_id] = {
            "id": member_id,
            "name": body.first_admin.name,
            "display_name": body.first_admin.name.split()[0],
            "title": None,
            "email": str(body.first_admin.email).lower(),
            "org_role": "owner",
            "created_at": store.now(),
            "status": "active",
        }
        return out(Organisation, org_view(state), 201)


@router.get("/org/setup/status", operation_id="getOrgSetupStatus", status_code=200, response_model=SetupStatus)
def get_org_setup_status():
    with STORE.read() as state:
        steps = {
            "org": "done" if owners(state) else "pending",
            "mail": "done" if state["org"].get("mail_config") else "pending",
            "first_project": "done" if state["projects"] else "pending",
            "first_source": "done" if state["sources"] else "pending",
        }
        return out(SetupStatus, {"completed": all(v == "done" for v in steps.values()), "steps": steps})

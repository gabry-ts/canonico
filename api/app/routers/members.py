from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse

from app import access, ops
from app.http import dump
from app.models import Me, RolePermissions
from app.store import STORE

router = APIRouter()


@router.get("/me", operation_id="getMe", status_code=200, response_model=Me)
def get_me(x_demo_actor: str | None = Header(None), actor: str | None = None, project_id: str | None = None):
    """Demo identity. `name` and `title` are added for the page header."""
    with STORE.read() as state:
        if project_id is not None:
            ops.require_project(state, project_id)
        member = access.actor_of(state, x_demo_actor, actor)
        if member is None:
            return JSONResponse({"code": "not_found", "message": "No member exists yet."}, status_code=404)
        view = access.me_view(state, member, project_id)
        return JSONResponse({**dump(Me, view), "name": view["name"], "title": view["title"]})


@router.get("/roles", operation_id="listRoles", status_code=200, response_model=list[RolePermissions])
def list_roles():
    return JSONResponse(dump(list[RolePermissions], [{"role": role, "permissions": access.PERMISSIONS[role]} for role in access.ROLE_ORDER]))

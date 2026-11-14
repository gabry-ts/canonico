from fastapi import APIRouter, Request, Response

from app import access, auth
from app.http import ApiError, not_found, out
from app.models import DemoLoginRequest, LoginRequest, LoginResponse
from app.store import STORE

router = APIRouter(tags=["auth"])


def _signed_in(request: Request, member: dict) -> Response:
    token, expires_at = auth.issue(member["id"])
    response = out(LoginResponse, {"member": access.member_view(member), "token": token, "expires_at": expires_at})
    response.set_cookie(auth.COOKIE, token, max_age=auth.TTL_S, path="/", httponly=True, samesite="lax", secure=auth.is_https(request))
    return response


@router.post("/auth/login", operation_id="login", status_code=200, response_model=LoginResponse)
def login(body: LoginRequest, request: Request):
    with STORE.read() as state:
        member = auth.check_credentials(state, body.email, body.password)
    if member is None:
        raise ApiError(401, "Wrong email or password.")
    return _signed_in(request, member)


@router.post("/auth/demo-login", operation_id="demoLogin", status_code=200, response_model=LoginResponse)
def demo_login(request: Request, body: DemoLoginRequest | None = None):
    if not auth.demo_login_enabled():
        raise not_found("Demo sign-in")
    member_id = (body.member_id if body else None) or auth.DEFAULT_DEMO_MEMBER
    with STORE.read() as state:
        member = state["members"].get(member_id)
    if member is None:
        raise not_found(f"Member {member_id}")
    return _signed_in(request, member)


@router.post("/auth/logout", operation_id="logout", status_code=204, response_model=None)
def logout(request: Request):
    auth.revoke(auth.token_of(request))
    response = Response(status_code=204)
    response.delete_cookie(auth.COOKIE, path="/", httponly=True, samesite="lax", secure=auth.is_https(request))
    return response

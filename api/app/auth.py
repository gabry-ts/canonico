"""Username and password sessions.

A random token is handed to the client (cookie or bearer) and only its SHA-256 is kept, with the
member, the creation time and the expiry. Sessions are written to their own file next to the state
(settings.sessions_file), so they survive a restart or a redeploy and are left alone by a demo reset.
With CANONICO_AUTH_REQUIRED=true every write needs a session; reads stay public.
When a session is present its member is the actor of the request, whatever the demo header or the
`actor` field of the body say.
"""

import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from datetime import datetime, timezone

from fastapi.responses import JSONResponse
from starlette.requests import Request

from app import i18n, settings, store
from app.store import STORE

COOKIE = "canonico_session"
TTL_S = 7 * 24 * 3600
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
PUBLIC_WRITE_PREFIXES = ("/auth/", "/hooks/")
PUBLIC_WRITE_PATHS = {"/health"}
DEFAULT_DEMO_MEMBER = "mem-giulia-ferri"

_sessions: dict[str, dict] = {}
_loaded = False
_lock = threading.Lock()


def _flag(name: str, default: bool) -> bool:
    value = settings.env(name, "").strip().lower()
    if not value:
        return default
    return value in ("1", "true", "yes", "on")


def required() -> bool:
    return _flag("CANONICO_AUTH_REQUIRED", False)


def demo_login_enabled() -> bool:
    return _flag("CANONICO_DEMO_LOGIN", True)


def hash_password(password: str, salt: bytes | None = None, iterations: int = 200_000) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iterations, salt, digest = stored.split("$")
    except ValueError:
        return False
    if scheme != "pbkdf2_sha256":
        return False
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations))
    return hmac.compare_digest(candidate.hex(), digest)


# Checked against when the email is unknown, so both failures take about the same time.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def password_hashes() -> dict[str, str]:
    path = store.seed_dir() / "credentials.json"
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("password_hashes", {})
    except (OSError, ValueError):
        return {}


def check_credentials(state: dict, email: str, password: str) -> dict | None:
    wanted = email.strip().lower()
    member = next((m for m in state["members"].values() if m["email"].lower() == wanted), None)
    stored = password_hashes().get(member["id"]) if member else None
    ok = verify_password(password, stored or _DUMMY_HASH)
    return member if ok and stored else None


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _load() -> None:
    """Read the sessions file once per process. Call with the lock held."""
    global _loaded
    if _loaded:
        return
    _loaded = True
    path = settings.sessions_file()
    if not path or not path.exists():
        return
    try:
        stored = json.loads(path.read_text(encoding="utf-8")).get("sessions", {})
    except (OSError, ValueError, AttributeError):
        return
    now = time.time()
    _sessions.update({d: s for d, s in stored.items() if isinstance(s, dict) and s.get("member_id") and s.get("expires_at", 0) > now})


def _save() -> None:
    """Write the live sessions to disk, dropping expired ones. Call with the lock held."""
    now = time.time()
    for digest in [d for d, s in _sessions.items() if s["expires_at"] <= now]:
        del _sessions[digest]
    path = settings.sessions_file()
    if not path:
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"sessions": _sessions}), encoding="utf-8")
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except OSError:
        pass


def reload() -> None:
    """Forget the sessions held in memory: the next lookup reads the file again, as after a restart."""
    global _loaded
    with _lock:
        _sessions.clear()
        _loaded = False


def issue(member_id: str) -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    created = time.time()
    expires = created + TTL_S
    with _lock:
        _load()
        _sessions[_digest(token)] = {"member_id": member_id, "created_at": created, "expires_at": expires}
        _save()
    return token, datetime.fromtimestamp(expires, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def revoke(token: str | None) -> None:
    if token:
        with _lock:
            _load()
            if _sessions.pop(_digest(token), None) is not None:
                _save()


def session_member_id(token: str | None) -> str | None:
    if not token:
        return None
    with _lock:
        _load()
        entry = _sessions.get(_digest(token))
        if entry is None:
            return None
        if entry["expires_at"] <= time.time():
            _sessions.pop(_digest(token), None)
            _save()
            return None
        return entry["member_id"]


def token_of(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return request.cookies.get(COOKIE) or None


def is_https(request: Request) -> bool:
    forwarded = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    return settings.public_url().lower().startswith("https://") or request.url.scheme == "https" or forwarded == "https"


def session_member(request: Request) -> dict | None:
    member_id = session_member_id(token_of(request))
    if member_id is None:
        return None
    with STORE.read() as state:
        return state["members"].get(member_id)


def _needs_session(method: str, path: str) -> bool:
    if path == "/me":
        return True
    if method not in WRITE_METHODS:
        return False
    return path not in PUBLIC_WRITE_PATHS and not path.startswith(PUBLIC_WRITE_PREFIXES)


def actor_name(member: dict) -> str:
    return member.get("display_name") or member["name"].split()[0]


class AuthMiddleware:
    """Enforces sessions on writes when required and makes the session member the actor."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request = Request(scope)
        member = session_member(request)
        if member is None:
            if required() and _needs_session(scope["method"], scope["path"]):
                response = JSONResponse({"code": "unauthorized", "message": i18n.error_message("Sign in to make changes.")}, status_code=401)
                await response(scope, receive, send)
                return
            await self.app(scope, receive, send)
            return

        headers = [(k, v) for k, v in scope["headers"] if k not in (b"x-demo-actor", b"content-length")]
        headers.append((b"x-demo-actor", member["id"].encode("utf-8")))
        body = b""
        if scope["method"] in WRITE_METHODS:
            more = True
            while more:
                message = await receive()
                body += message.get("body", b"")
                more = message.get("more_body", False)
            if "json" in request.headers.get("content-type", ""):
                body = _with_actor(body, actor_name(member))
            headers.append((b"content-length", str(len(body)).encode()))
        else:
            headers.extend((k, v) for k, v in scope["headers"] if k == b"content-length")
        scope = {**scope, "headers": headers}
        if scope["method"] not in WRITE_METHODS:
            await self.app(scope, receive, send)
            return

        sent = False

        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


def _with_actor(body: bytes, actor: str) -> bytes:
    """Replace the `actor` field of a JSON body with the session member."""
    try:
        data = json.loads(body)
    except ValueError:
        return body
    if not isinstance(data, dict) or "actor" not in data:
        return body
    data["actor"] = actor
    return json.dumps(data, ensure_ascii=False).encode("utf-8")

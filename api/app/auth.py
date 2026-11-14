"""Username and password sessions.

A random token is handed to the client (HttpOnly cookie, or bearer for API clients) and only its
SHA-256 is kept, in memory and in `sessions.json` next to the runtime state, so a restart or a
redeploy keeps the sessions that have not expired. With CANONICO_AUTH_REQUIRED=true every request
needs a session, except the health check, the sign-in endpoints, first-run setup and the webhooks
(which check their own X-Canonico-Token). When a session is present its member is the actor of the
request, whatever the demo header or the `actor` field of the body say.
"""

import hashlib
import hmac
import json
import logging
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
TTL_S = 12 * 3600
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# Reachable without a session even when sessions are required. The webhooks authenticate with their own token,
# first-run setup refuses once the organisation has an owner, and the API description is the public contract.
PUBLIC_PREFIXES = ("/auth/", "/hooks/")
PUBLIC_PATHS = {"/health", "/org/setup", "/org/setup/status", "/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"}
DEFAULT_DEMO_MEMBER = "mem-giulia-ferri"
SESSION_REQUIRED = "Sign in to continue."
LOG = logging.getLogger("uvicorn.error")

_sessions: dict[str, tuple[str, float]] = {}
_loaded_from: str | None = None
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


def sessions_file():
    """Where sessions are kept between restarts: next to the runtime state (the canonico-runtime volume)."""
    state = settings.state_file()
    return state.parent / "sessions.json" if state else None


def _ensure_loaded() -> None:
    """Read the saved sessions once per sessions file. Call with the lock held."""
    global _loaded_from
    path = sessions_file()
    key = str(path) if path else ""
    if _loaded_from == key:
        return
    _loaded_from = key
    _sessions.clear()
    if not path or not path.exists():
        return
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        LOG.warning("sessions: %s could not be read, everyone signs in again", path)
        return
    now = time.time()
    for digest, entry in (raw.get("sessions") or {}).items():
        try:
            member_id, expires = str(entry[0]), float(entry[1])
        except (TypeError, ValueError, IndexError):
            continue
        if expires > now:
            _sessions[digest] = (member_id, expires)


def _save() -> None:
    """Persist the live sessions (token digests only). Call with the lock held."""
    path = sessions_file()
    if not path:
        return
    now = time.time()
    live = {d: [m, e] for d, (m, e) in _sessions.items() if e > now}
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"sessions": live}), encoding="utf-8")
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except OSError:
        LOG.warning("sessions: %s could not be written", path)


def issue(member_id: str) -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    expires = time.time() + TTL_S
    with _lock:
        _ensure_loaded()
        _sessions[_digest(token)] = (member_id, expires)
        _save()
    return token, expires_text(expires)


def expires_text(expires: float) -> str:
    return datetime.fromtimestamp(expires, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def revoke(token: str | None) -> None:
    if token:
        with _lock:
            _ensure_loaded()
            if _sessions.pop(_digest(token), None) is not None:
                _save()


def revoke_member(member_id: str) -> None:
    """End every session of a member, for example when the member is removed."""
    with _lock:
        _ensure_loaded()
        doomed = [d for d, (m, _) in _sessions.items() if m == member_id]
        for digest in doomed:
            del _sessions[digest]
        if doomed:
            _save()


def session_entry(token: str | None) -> tuple[str, float] | None:
    """(member id, expiry) of a live session, or None."""
    if not token:
        return None
    with _lock:
        _ensure_loaded()
        entry = _sessions.get(_digest(token))
        if entry is None:
            return None
        if entry[1] < time.time():
            _sessions.pop(_digest(token), None)
            _save()
            return None
        return entry


def session_member_id(token: str | None) -> str | None:
    entry = session_entry(token)
    return entry[0] if entry else None


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


def session_expiry(request: Request) -> str | None:
    """Expiry of the session the request carries, None without one."""
    entry = session_entry(token_of(request))
    return expires_text(entry[1]) if entry else None


def _needs_session(method: str, path: str) -> bool:
    """With sessions required, everything but the public endpoints needs one. CORS preflights never do."""
    if method == "OPTIONS":
        return False
    return path not in PUBLIC_PATHS and not path.startswith(PUBLIC_PREFIXES)


def actor_name(member: dict) -> str:
    return member.get("display_name") or member["name"].split()[0]


class AuthMiddleware:
    """Enforces sessions when required and makes the session member the actor."""

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
                response = JSONResponse({"code": "unauthorized", "message": i18n.error_message(SESSION_REQUIRED)}, status_code=401)
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

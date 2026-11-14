"""Email and password sessions, the demo sign-in and enforcement of sessions on writes."""

import hashlib
import json
import time

import pytest

from app import auth, settings
from app.store import STORE
from tests.conftest import assert_contract

GIULIA = {"email": "giulia.ferri@meridianlabs.org", "password": "canonico-demo"}
RETIRE = {"reason": "The final report replaced the verbal preview.", "actor": "Someone else"}
Q = "How long does onboarding take?"


@pytest.fixture()
def required(monkeypatch):
    monkeypatch.setenv("CANONICO_AUTH_REQUIRED", "true")


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_login_sets_a_session_cookie_and_returns_the_member(client):
    response = client.post("/auth/login", json=GIULIA)
    body = assert_contract(response, "POST", "/auth/login")
    assert body["member"]["id"] == "mem-giulia-ferri" and body["token"]
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{auth.COOKIE}=") and "HttpOnly" in cookie and "samesite=lax" in cookie.lower() and "Path=/" in cookie
    assert "Secure" not in cookie
    assert client.get("/me", headers={"X-Demo-Actor": "Luca"}).json()["member"]["id"] == "mem-giulia-ferri"


def test_login_is_case_insensitive_on_email_and_secure_behind_https(client):
    response = client.post("/auth/login", json={**GIULIA, "email": "Giulia.Ferri@MeridianLabs.org"}, headers={"X-Forwarded-Proto": "https"})
    assert response.status_code == 200 and "Secure" in response.headers["set-cookie"]


def test_wrong_password_and_unknown_email_give_the_same_401(client):
    wrong = client.post("/auth/login", json={**GIULIA, "password": "nope"})
    unknown = client.post("/auth/login", json={"email": "nobody@meridianlabs.org", "password": "canonico-demo"})
    assert_contract(wrong, "POST", "/auth/login", 401)
    assert wrong.json() == unknown.json() and unknown.status_code == 401
    assert "set-cookie" not in wrong.headers


def test_passwords_are_stored_hashed():
    hashes = auth.password_hashes()
    assert set(hashes) == {"mem-giulia-ferri", "mem-sara-conti", "mem-luca-bassi", "mem-gabriele-partiti", "mem-emanuele-beffa", "mem-davide-chiattelli"}
    assert all(h.startswith("pbkdf2_sha256$") and "canonico-demo" not in h for h in hashes.values())
    assert len({h.split("$")[2] for h in hashes.values()}) == 6


def test_demo_login_defaults_to_giulia_and_accepts_a_member(client):
    body = assert_contract(client.post("/auth/demo-login"), "POST", "/auth/demo-login")
    assert body["member"]["id"] == "mem-giulia-ferri"
    body = client.post("/auth/demo-login", json={"member_id": "mem-luca-bassi"}).json()
    assert body["member"]["org_role"] == "viewer"
    assert_contract(client.post("/auth/demo-login", json={"member_id": "mem-nobody"}), "POST", "/auth/demo-login", 404)


def test_demo_login_off_is_404(client, monkeypatch):
    monkeypatch.setenv("CANONICO_DEMO_LOGIN", "false")
    assert_contract(client.post("/auth/demo-login"), "POST", "/auth/demo-login", 404)


def test_logout_revokes_the_token_and_clears_the_cookie(client, required):
    token = client.post("/auth/login", json=GIULIA).json()["token"]
    assert client.post("/facts/M-105/retire", json=RETIRE).status_code == 200
    response = client.post("/auth/logout")
    assert response.status_code == 204 and f'{auth.COOKIE}=""' in response.headers["set-cookie"]
    assert client.post("/facts/M-105/restore", json={"actor": "x"}).status_code == 401
    assert client.post("/facts/M-105/restore", headers=bearer(token)).status_code == 401


def test_bearer_token_works_without_the_cookie(client, required):
    token = client.post("/auth/login", json=GIULIA).json()["token"]
    client.cookies.clear()
    assert client.post("/facts/M-105/retire", json=RETIRE).status_code == 401
    assert client.post("/facts/M-105/retire", json=RETIRE, headers=bearer(token)).status_code == 200
    assert client.get("/me", headers=bearer(token)).json()["member"]["id"] == "mem-giulia-ferri"
    assert client.post("/facts/M-105/restore", headers=bearer("not-a-token")).status_code == 401


READS = [
    "/export", "/facts", "/facts/M-105", "/audit", "/topics", "/conflicts", "/stats", "/org", "/projects",
    "/projects/proj-clearpath/sources", "/sources/src-clearpath-docs", "/org/members", "/org/mail", "/config",
    "/org/hooks", "/me", "/search?q=M-105", "/documents", "/maintenance/queue", "/open-questions", "/roles",
]


def test_everything_needs_a_session_when_required(client, required):
    response = client.post("/facts/M-105/retire", json=RETIRE, headers={"X-Demo-Actor": "Giulia"})
    body = assert_contract(response, "POST", "/facts/{fact_id}/retire", 401)
    assert body == {"code": "unauthorized", "message": "Sign in to continue."}
    assert client.post("/demo/reset").status_code == 401
    assert client.patch("/facts/M-105", json={"reason": "x", "actor": "x"}).status_code == 401
    for path in READS:
        got = client.get(path, headers={"X-Demo-Actor": "Giulia"})
        assert got.status_code == 401, path
        assert got.json()["code"] == "unauthorized", path
    members = client.get("/org/members")
    assert "@" not in members.text
    assert client.get("/facts", headers={"Accept-Language": "it"}).json()["message"] == "Accedi per continuare."
    assert client.get("/health").status_code == 200
    assert client.get("/org/setup/status").status_code == 200
    # The webhooks check their own token, not a session.
    hook = client.post("/hooks/org", json={})
    assert hook.status_code == 401 and "X-Canonico-Token" in hook.text
    assert client.post("/hooks/org", json={}, headers={"X-Canonico-Token": "whsec_x7Kq2demo9f2a"}).status_code in (400, 422)
    # CORS preflights never need a session.
    preflight = client.options("/facts", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
    assert preflight.status_code == 200 and preflight.headers["access-control-allow-credentials"] == "true"


def test_reads_work_with_a_session_cookie_only(client, required):
    client.post("/auth/login", json=GIULIA)
    for path in READS:
        assert client.get(path).status_code == 200, path
    me = assert_contract(client.get("/me"), "GET", "/me")
    assert me["member"]["id"] == "mem-giulia-ferri" and me["session_expires_at"].endswith("Z")


def test_me_says_whether_a_session_is_behind_it(client):
    assert client.get("/me").json()["session_expires_at"] is None
    login = client.post("/auth/login", json=GIULIA).json()
    assert client.get("/me").json()["session_expires_at"] == login["expires_at"]


def test_sessions_survive_a_restart(client, required):
    token = client.post("/auth/login", json=GIULIA).json()["token"]
    path = auth.sessions_file()
    assert path.exists() and token not in path.read_text()
    # A new process: the sessions are read back from disk.
    with auth._lock:
        auth._sessions.clear()
        auth._loaded_from = None
    assert client.get("/me", headers=bearer(token)).status_code == 200
    client.post("/auth/logout", headers=bearer(token))
    with auth._lock:
        auth._sessions.clear()
        auth._loaded_from = None
    assert client.get("/me", headers=bearer(token)).status_code == 401


def test_expired_sessions_are_not_restored(client, required, monkeypatch):
    token = client.post("/auth/login", json=GIULIA).json()["token"]
    with auth._lock:
        auth._sessions.clear()
        auth._loaded_from = None
    import time

    later = time.time() + auth.TTL_S + 60
    monkeypatch.setattr(auth.time, "time", lambda: later)
    assert client.get("/me", headers=bearer(token)).status_code == 401


def test_removing_a_member_ends_their_sessions(client, required):
    luca = client.post("/auth/login", json={"email": "luca.bassi@meridianlabs.org", "password": "canonico-demo"}).json()["token"]
    giulia = client.post("/auth/login", json=GIULIA).json()["token"]
    assert client.delete("/org/members/mem-luca-bassi", headers=bearer(giulia)).status_code == 204
    assert client.get("/me", headers=bearer(luca)).status_code == 401


def test_session_member_is_the_actor_in_the_audit(client, required):
    client.post("/auth/login", json=GIULIA)
    retired = client.post("/facts/M-105/retire", json=RETIRE, headers={"X-Demo-Actor": "Luca"}).json()
    assert retired["retired_by"] == "Giulia"
    events = client.get("/audit", params={"fact_id": "M-105"}).json()
    assert events[0]["actor"] == "Giulia" and events[0]["actor_role"] == "owner"


def test_viewer_session_gets_403_on_retire(client, required):
    client.post("/auth/login", json={"email": "luca.bassi@meridianlabs.org", "password": "canonico-demo"})
    response = client.post("/facts/M-105/retire", json=RETIRE, headers={"X-Demo-Actor": "Giulia"})
    assert_contract(response, "POST", "/facts/{fact_id}/retire", 403)
    assert client.post("/demo/reset").status_code == 403


def test_without_the_flag_nothing_changes_for_anonymous_callers(client):
    assert client.get("/me").json()["member"]["id"] == "mem-giulia-ferri"
    assert client.get("/me", headers={"X-Demo-Actor": "Luca"}).json()["role"] == "viewer"
    assert client.post("/facts/M-105/retire", json=RETIRE, headers={"X-Demo-Actor": "Luca"}).status_code == 403
    assert client.post("/facts/M-105/retire", json=RETIRE).json()["retired_by"] == "Someone else"


def test_video_flow_signed_in_as_giulia_with_auth_required(client, required):
    assert client.post("/auth/demo-login").status_code == 200
    assert client.post("/demo/reset").status_code == 200
    before = client.post("/ask", json={"question": Q}).json()
    assert before["binding"]["id"] == "M-106" and [f["id"] for f in before["conflicts"]] == ["M-105"]
    retired = client.post("/facts/M-105/retire", json={"reason": "The final report replaced the verbal preview.", "actor": "Giulia"})
    assert retired.status_code == 200 and retired.json()["retired_by"] == "Giulia"
    after = client.post("/ask", json={"question": Q}).json()
    assert after["conflicts"] == [] and after["changed_because"] == "Giulia retired 4 weeks (final presentation)"
    assert after["answer"] != before["answer"]
    assert client.post("/demo/reset").status_code == 200


def test_cookie_is_secure_when_public_url_is_https(client, monkeypatch):
    monkeypatch.setenv("CANONICO_PUBLIC_URL", "https://brain.example.org/api")
    response = client.post("/auth/login", json=GIULIA, headers={"X-Forwarded-Proto": "http"})
    cookie = response.headers["set-cookie"]
    assert "Secure" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie and "Path=/" in cookie
    assert "Secure" in client.post("/auth/logout").headers["set-cookie"]


def test_cookie_is_not_secure_on_plain_http_without_public_url(client, monkeypatch):
    monkeypatch.delenv("CANONICO_PUBLIC_URL", raising=False)
    cookie = client.post("/auth/login", json=GIULIA).headers["set-cookie"]
    assert "Secure" not in cookie


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def test_session_survives_a_restart_and_is_stored_hashed(client, required):
    token = client.post("/auth/login", json=GIULIA).json()["token"]
    path = settings.sessions_file()
    assert path.parent == settings.state_file().parent and token not in path.read_text(encoding="utf-8")
    record = json.loads(path.read_text(encoding="utf-8"))["sessions"][_digest(token)]
    assert record["member_id"] == "mem-giulia-ferri" and record["expires_at"] - record["created_at"] == auth.TTL_S == 7 * 24 * 3600
    auth.reload()
    STORE.state = None
    client.cookies.clear()
    assert client.post("/facts/M-105/retire", json=RETIRE, headers=bearer(token)).status_code == 200
    assert client.get("/me", headers=bearer(token)).json()["member"]["id"] == "mem-giulia-ferri"


def test_demo_reset_keeps_people_signed_in(client, required):
    token = client.post("/auth/login", json=GIULIA).json()["token"]
    client.cookies.clear()
    assert client.post("/demo/reset", headers=bearer(token)).status_code == 200
    auth.reload()
    assert client.post("/facts/M-105/retire", json=RETIRE, headers=bearer(token)).status_code == 200


def test_logout_revokes_the_session_on_disk(client, required):
    token = client.post("/auth/login", json=GIULIA).json()["token"]
    client.cookies.clear()
    assert client.post("/auth/logout", headers=bearer(token)).status_code == 204
    auth.reload()
    assert client.post("/facts/M-105/retire", json=RETIRE, headers=bearer(token)).status_code == 401
    assert _digest(token) not in settings.sessions_file().read_text(encoding="utf-8")


def test_expired_sessions_are_refused_and_dropped(client, required, monkeypatch):
    token = client.post("/auth/login", json=GIULIA).json()["token"]
    client.cookies.clear()
    later = time.time() + auth.TTL_S + 1
    monkeypatch.setattr(auth.time, "time", lambda: later)
    assert client.post("/facts/M-105/retire", json=RETIRE, headers=bearer(token)).status_code == 401
    assert _digest(token) not in settings.sessions_file().read_text(encoding="utf-8")

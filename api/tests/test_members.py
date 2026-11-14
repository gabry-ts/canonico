"""Members, roles, demo identity, permission checks, setup status and dashboard statistics."""

from app import github
from tests.conftest import assert_contract, assert_matches

Q = "How long does onboarding take?"
CLEARPATH, INTERNAL = "proj-clearpath", "proj-internal"
RETIRE = {"reason": "The final report replaced the verbal preview.", "actor": "Giulia"}
AS_LUCA = {"X-Demo-Actor": "mem-luca-bassi"}
AS_SARA = {"X-Demo-Actor": "mem-sara-conti"}


def test_roles_matrix_matches_the_contract(client, spec):
    roles = assert_contract(client.get("/roles"), "GET", "/roles")
    assert roles == spec["paths"]["/roles"]["get"]["responses"]["200"]["content"]["application/json"]["example"]


def test_members_can_be_invited_changed_and_removed(client, spec):
    page = assert_contract(client.get("/org/members"), "GET", "/org/members")
    example = spec["paths"]["/org/members"]["get"]["responses"]["200"]["content"]["application/json"]["example"]
    assert_matches({**page, "items": page["items"][:3], "total": 3}, example)
    assert page["total"] == 6
    invited = assert_contract(client.post("/org/members", json={"name": "Marta Riva", "email": "marta.riva@meridianlabs.org", "org_role": "viewer"}), "POST", "/org/members", 201)
    assert invited["id"] == "mem-marta-riva" and invited["status"] == "invited" and invited["org_role"] == "viewer"
    assert_contract(client.post("/org/members", json={"name": "Marta Riva", "email": "other@meridianlabs.org", "org_role": "viewer"}), "POST", "/org/members", 409)
    assert_contract(client.post("/org/members", json={"name": "Marta"}), "POST", "/org/members", 422)
    assert assert_contract(client.get("/org/members/mem-marta-riva"), "GET", "/org/members/{member_id}") == invited
    promoted = assert_contract(client.patch("/org/members/mem-marta-riva", json={"org_role": "admin"}), "PATCH", "/org/members/{member_id}")
    assert promoted["org_role"] == "admin"
    assert client.get("/me", headers={"X-Demo-Actor": "Marta"}).json()["role"] == "admin"
    assert client.delete("/org/members/mem-marta-riva").status_code == 204
    assert_contract(client.get("/org/members/mem-marta-riva"), "GET", "/org/members/{member_id}", 404)
    for team in ("gabriele-partiti", "emanuele-beffa", "davide-chiattelli"):
        assert client.delete(f"/org/members/mem-{team}").status_code == 204
    assert_contract(client.delete("/org/members/mem-giulia-ferri"), "DELETE", "/org/members/{member_id}", 409)
    assert_contract(client.patch("/org/members/mem-giulia-ferri", json={"org_role": "viewer"}), "PATCH", "/org/members/{member_id}", 409)
    assert client.get("/org/members").json()["total"] == 3


def test_project_role_is_inherited_until_overridden(client):
    members = assert_contract(client.get(f"/projects/{CLEARPATH}/members"), "GET", "/projects/{project_id}/members")
    assert {m["member_id"]: (m["role"], m["inherited"]) for m in members} == {
        "mem-giulia-ferri": ("owner", True), "mem-sara-conti": ("editor", True), "mem-luca-bassi": ("viewer", True),
        "mem-gabriele-partiti": ("owner", True), "mem-emanuele-beffa": ("owner", True), "mem-davide-chiattelli": ("owner", True)}
    body = {"member_id": "mem-luca-bassi", "role": "editor"}
    changed = assert_contract(client.put(f"/projects/{CLEARPATH}/members/mem-luca-bassi", json=body), "PUT", "/projects/{project_id}/members/{member_id}")
    assert changed == {"member_id": "mem-luca-bassi", "project_id": CLEARPATH, "role": "editor", "inherited": False}
    by_id = {m["member_id"]: m for m in client.get(f"/projects/{CLEARPATH}/members").json()}
    assert (by_id["mem-luca-bassi"]["role"], by_id["mem-luca-bassi"]["inherited"]) == ("editor", False)
    assert {m["member_id"]: m["role"] for m in client.get(f"/projects/{INTERNAL}/members").json()}["mem-luca-bassi"] == "viewer"
    assert client.get("/me", headers=AS_LUCA).json()["role"] == "viewer"
    scoped = assert_contract(client.get("/me", headers=AS_LUCA, params={"project_id": CLEARPATH}), "GET", "/me")
    assert scoped["role"] == "editor" and "retire_fact" in scoped["permissions"]

    assert client.post("/facts/M-105/retire", json=RETIRE, headers=AS_LUCA).status_code == 200
    assert client.post("/facts/M-905/retire", json=RETIRE, headers=AS_LUCA).status_code == 403

    cleared = assert_contract(client.delete(f"/projects/{CLEARPATH}/members/mem-luca-bassi"), "DELETE", "/projects/{project_id}/members/{member_id}")
    assert cleared == {"member_id": "mem-luca-bassi", "project_id": CLEARPATH, "role": "viewer", "inherited": True}
    assert_contract(client.put(f"/projects/{CLEARPATH}/members/mem-luca-bassi", json={"member_id": "mem-sara-conti", "role": "editor"}), "PUT", "/projects/{project_id}/members/{member_id}", 422)
    assert_contract(client.put(f"/projects/{CLEARPATH}/members/mem-nobody", json={"member_id": "mem-nobody", "role": "editor"}), "PUT", "/projects/{project_id}/members/{member_id}", 404)
    assert_contract(client.get("/projects/nope/members"), "GET", "/projects/{project_id}/members", 404)


def test_writes_are_refused_without_the_permission(client):
    refused = assert_contract(client.post("/facts/M-105/retire", json=RETIRE, headers=AS_LUCA), "POST", "/facts/{fact_id}/retire", 403)
    assert refused == {"code": "forbidden", "message": "Role viewer lacks permission retire_fact."}
    assert client.get("/facts/M-105").json()["status"] == "active"
    assert client.post("/ask", json={"question": Q}, headers=AS_LUCA).status_code == 200
    assert client.post("/facts/M-105/retire", json=RETIRE, headers=AS_SARA).status_code == 200
    assert_contract(client.post("/demo/reset", headers=AS_SARA), "POST", "/demo/reset", 403)
    assert_contract(client.post("/org/members", json={"name": "X Y", "email": "x@y.example", "org_role": "viewer"}, headers=AS_SARA), "POST", "/org/members", 403)
    assert_contract(client.put("/org/mail", json={"mode": "webhook"}, headers=AS_SARA), "PUT", "/org/mail", 403)
    assert_contract(client.post("/sources/src-clearpath-docs/sync", headers=AS_SARA), "POST", "/sources/{source_id}/sync", 403)
    assert_contract(client.post("/conflicts/C-002/resolve", json={"winning_fact_id": "M-202", "reason": "x", "actor": "Luca"}, headers=AS_LUCA), "POST", "/conflicts/{conflict_id}/resolve", 403)
    assert client.post("/demo/reset").status_code == 200
    assert client.post("/facts/M-105/retire", json=RETIRE).status_code == 200
    assert client.post("/facts/M-105/restore", json={"actor": "Giulia"}, headers={"X-Demo-Actor": "someone unknown"}).status_code == 200


def test_writes_that_had_no_check_now_need_a_role(client):
    viewer = [
        ("post", "/facts", {"json": {"topic": "onboarding-target", "value": "x", "type": "DECISION", "date": "2026-01-01", "quote": "x", "actor": "Luca"}}),
        ("post", "/facts/M-105/supersede", {"json": {"by_fact_id": "M-106", "reason": "x", "actor": "Luca"}}),
        ("post", "/topics", {"json": {"label": "New topic"}}),
        ("post", "/documents", {"json": {"title": "Note", "date": "2026-01-01", "text": "hello", "ingest": False}}),
        ("post", "/mail/poll", {"json": {}}),
    ]
    for method, path, kwargs in viewer:
        response = getattr(client, method)(path, headers=AS_LUCA, **kwargs)
        assert response.status_code == 403, (path, response.text)
    editor = [
        ("patch", "/org", {"json": {"name": "Other"}}),
        ("post", "/projects", {"json": {"name": "Side project"}}),
        ("delete", f"/projects/{INTERNAL}", {}),
        ("patch", "/config", {"json": {"offline_mode": True}}),
        ("post", "/eval/run", {}),
        ("post", "/ingest", {"json": {"force": True}}),
    ]
    for method, path, kwargs in editor:
        response = getattr(client, method)(path, headers=AS_SARA, **kwargs)
        assert response.status_code == 403, (path, response.text)
    assert client.patch("/config", json={"offline_mode": True}, headers=AS_SARA).json()["message"] == "Role editor needs at least role admin."
    assert client.post("/mail/poll", json={}, headers=AS_SARA).status_code == 200
    assert client.post("/topics", json={"label": "Editor topic"}, headers=AS_SARA).status_code == 201
    assert client.get("/org").json()["name"] != "Other"
    assert client.get(f"/projects/{INTERNAL}").status_code == 200


def test_setup_status_and_first_run(client):
    status = assert_contract(client.get("/org/setup/status"), "GET", "/org/setup/status")
    assert status == {"completed": True, "steps": {"org": "done", "mail": "done", "first_project": "done", "first_source": "done"}}
    body = {"organisation_name": "Meridian Labs", "primary_email_domain": "meridianlabs.org", "first_admin": {"name": "Giulia Ferri", "email": "giulia.ferri@meridianlabs.org"}}
    assert_contract(client.post("/org/setup", json=body), "POST", "/org/setup", 409)
    assert_contract(client.post("/org/setup", json={}), "POST", "/org/setup", 422)


def test_documents_carry_source_type_and_version(client):
    library = assert_contract(client.get("/documents", params={"source_type": "document_library"}), "GET", "/documents")
    assert {d["id"]: (d["version"], d["current_version"], d["source_type"]) for d in library} == {
        "library/onboarding-standard": (2, 2, "document_library"), "library/audit-handbook": (1, 1, "document_library")}
    assert len(client.get("/documents", params={"source_id": "src-clearpath-docs"}).json()) == 46
    rows = assert_contract(client.get("/sources/src-clearpath-library/documents"), "GET", "/sources/{source_id}/documents")
    assert [d["id"] for d in rows] == ["library/onboarding-standard", "library/audit-handbook"] and "text" not in rows[0]
    assert len(client.get("/sources/src-clearpath-docs/documents", params={"limit": 5}).json()) == 5
    assert_contract(client.get("/sources/nope/documents"), "GET", "/sources/{source_id}/documents", 404)


def test_github_preview(client, monkeypatch):
    preview = {"repo_url": "https://github.com/gabry-ts/canonico", "full_name": "gabry-ts/canonico", "public": True, "description": "Canonical memory.", "default_branch": "main", "open_issues": 3, "has_readme": True, "last_pushed_at": "2026-11-14T09:00:00Z"}
    monkeypatch.setattr(github, "preview", lambda owner, repo, offline=False: preview)
    assert assert_contract(client.post("/sources/github/preview", json={"repo_url": "https://github.com/gabry-ts/canonico"}), "POST", "/sources/github/preview") == preview
    assert_contract(client.post("/sources/github/preview", json={"repo_url": "https://example.com/x"}), "POST", "/sources/github/preview", 422)

    def missing(owner, repo, offline=False):
        raise github.GithubError("repository not found or not public")

    monkeypatch.setattr(github, "preview", missing)
    assert_contract(client.post("/sources/github/preview", json={"repo_url": "https://github.com/a/b"}), "POST", "/sources/github/preview", 404)


def test_dashboard_statistics_follow_the_memory(client):
    before = assert_contract(client.get("/stats"), "GET", "/stats")
    assert before["needs_attention"]["stale_active"] == 1
    assert before["needs_attention"]["conflicts_open"] == before["open_conflicts"]
    assert before["needs_attention"]["open_questions"] == before["open_questions"]
    assert before["facts_by_type"] == before["by_type"] and before["facts_by_status"] == before["by_status"]
    assert before["answers"]["binding"] == 0 and before["answers"]["since"] == before["last_reset_at"]
    assert before["time_to_fix_seconds"] == {"median": None, "samples": 0, "measured_at": None}
    assert {s["source_id"] for s in before["sources"]} >= {"src-clearpath-docs", "src-clearpath-mail", "src-internal-gh"}

    client.post("/ask", json={"question": Q})
    client.post("/ask", json={"question": "How long does a report spend in the audit queue?"})
    client.post("/ask", json={"question": "Who won the football world cup in 1982?"})
    client.post("/facts/M-105/retire", json=RETIRE)
    after = assert_contract(client.get("/stats"), "GET", "/stats")
    assert after["needs_attention"]["stale_active"] == 0
    assert after["needs_attention"]["conflicts_open"] == before["needs_attention"]["conflicts_open"] - 1
    assert after["by_status"]["retired"] == 1 and after["facts_by_status"]["active"] == before["facts_by_status"]["active"] - 1
    assert (after["answers"]["binding"], after["answers"]["contested"], after["answers"]["no_answer"]) == (1, 1, 1)
    assert after["recent_changes"][0] == {"at": after["recent_changes"][0]["at"], "actor": "Giulia", "action": "retire", "fact_id": "M-105", "summary": "Giulia retired 4 weeks (final presentation)"}
    assert after["time_to_fix_seconds"]["samples"] == 1 and after["time_to_fix_seconds"]["median"] >= 0 and after["time_to_fix_seconds"]["measured_at"]

    inside = assert_contract(client.get("/stats", params={"project_id": INTERNAL}), "GET", "/stats")
    assert inside["needs_attention"] == {"stale_active": 0, "conflicts_open": 0, "open_questions": 0}
    assert {s["source_id"] for s in inside["sources"]} == {"src-internal-docs", "src-internal-gh"}
    assert inside["recent_changes"] == [] and inside["answers"]["binding"] == 0
    assert assert_contract(client.get("/stats", params={"project_id": CLEARPATH}), "GET", "/stats")["answers"]["binding"] == 1

    client.post("/demo/send-email")
    doc = "/documents/library%2Fonboarding-standard"
    text = client.get(doc).json()["text"].replace("3–4 weeks", "5 weeks")
    client.post(doc + "/versions", json={"version_label": "v3", "text": text})
    actions = [c["action"] for c in client.get("/stats").json()["recent_changes"]]
    assert actions[:3] == ["new_version", "inbound_email", "retire"]
    assert len(client.get("/stats").json()["recent_changes"]) <= 10


def test_config_reports_offline_mode_and_provider(client):
    config = assert_contract(client.get("/config"), "GET", "/config")
    assert config["offline_mode"] is False and config["provider"] in ("anthropic", "gateway")
    on = assert_contract(client.patch("/config", json={"offline_mode": True}), "PATCH", "/config")
    assert on["offline_mode"] is True
    refused = client.post("/ingest", json={"force": True})
    assert refused.status_code == 422 and refused.json()["code"] == "offline_mode"
    assert client.post("/demo/send-email").json()["facts_created"] == ["E-301"]
    assert client.post("/demo/reset").json()["last_reset_at"]
    assert client.get("/config").json()["offline_mode"] is False

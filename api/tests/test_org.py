"""Organisation, projects with isolation, sources, inbound mail and document versions."""

import time

from app import github
from tests.conftest import assert_contract, assert_matches

Q = "How long does onboarding take?"
CLEARPATH, INTERNAL = "proj-clearpath", "proj-internal"
ORG_MAIL = {"mode": "imap_mock", "imap_host": "mock.meridianlabs.org", "imap_user": "brain@meridianlabs.org", "inbound_address": "brain@inbound.meridianlabs.org", "poll_interval_s": 60}
EMAIL = {"message_id": "<x-1@meridianlabs.org>", "from": "Client <client@meridianlabs.org>", "to": ["brain@inbound.meridianlabs.org"], "cc": [], "subject": "Hello", "date": "2026-11-14T14:30:00Z", "text": "Nothing to decide here.", "attachments": []}


def ask(client, question, **extra):
    return assert_contract(client.post("/ask", json={"question": question, **extra}), "POST", "/ask")


def wait_sync(client, job_id):
    for _ in range(200):
        job = assert_contract(client.get(f"/sync-jobs/{job_id}"), "GET", "/sync-jobs/{job_id}")
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.03)
    raise AssertionError("sync did not finish")


def test_organisation_and_projects(client, spec):
    org = assert_contract(client.get("/org"), "GET", "/org")
    assert_matches(org, spec["paths"]["/org"]["get"]["responses"]["200"]["content"]["application/json"]["example"])
    assert assert_contract(client.patch("/org", json={"name": "Meridian Labs Srl"}), "PATCH", "/org")["name"] == "Meridian Labs Srl"
    page = assert_contract(client.get("/projects"), "GET", "/projects")
    assert [p["id"] for p in page["items"]] == [CLEARPATH, INTERNAL] and page["total"] == 2
    clearpath = assert_contract(client.get(f"/projects/{CLEARPATH}"), "GET", "/projects/{project_id}")
    assert clearpath["name"] == "ClearPath engagement" and clearpath["mail_config_override"] is None
    assert clearpath["effective_mail_config"] == ORG_MAIL
    assert clearpath["source_ids"] == ["src-clearpath-docs", "src-clearpath-library", "src-clearpath-mail"]
    created = assert_contract(client.post("/projects", json={"name": "Pilot Team", "description": "Trial"}), "POST", "/projects", 201)
    assert created["id"] == "proj-pilot-team" and created["source_ids"] == []
    assert_contract(client.post("/projects", json={"id": CLEARPATH, "name": "Again"}), "POST", "/projects", 409)
    assert_contract(client.post("/projects", json={}), "POST", "/projects", 422)
    patched = assert_contract(client.patch("/projects/proj-pilot-team", json={"description": "Trial, closed."}), "PATCH", "/projects/{project_id}")
    assert patched["description"] == "Trial, closed."
    assert_contract(client.get("/projects/nope"), "GET", "/projects/{project_id}", 404)
    assert client.delete("/projects/proj-pilot-team").json() == {"id": "proj-pilot-team", "deleted": True}
    assert_contract(client.delete("/projects/proj-pilot-team"), "DELETE", "/projects/{project_id}", 404)


def test_a_project_sees_only_its_own_memory(client):
    internal = assert_contract(client.get("/facts", params={"project_id": INTERNAL, "limit": 500}), "GET", "/facts")
    assert {f["id"] for f in internal["items"]} == {"M-903", "M-904", "M-905"}
    assert {f["project_id"] for f in internal["items"]} == {INTERNAL}
    clearpath = client.get("/facts", params={"project_id": CLEARPATH, "limit": 500}).json()
    assert not {f["id"] for f in clearpath["items"]} & {"M-903", "M-904", "M-905"}
    everything = client.get("/facts", params={"limit": 500}).json()
    assert everything["total"] == internal["total"] + clearpath["total"]

    assert {t["project_id"] for t in assert_contract(client.get("/topics", params={"project_id": INTERNAL}), "GET", "/topics")} == {INTERNAL}
    assert [d["id"] for d in assert_contract(client.get("/documents", params={"project_id": INTERNAL}), "GET", "/documents")] == ["internal/analyst-handbook"]
    assert client.get("/conflicts", params={"project_id": INTERNAL}).json() == []
    assert "C-001" in [c["id"] for c in client.get("/conflicts", params={"project_id": CLEARPATH}).json()]
    assert client.get("/stats", params={"project_id": INTERNAL}).json()["facts_total"] == 3
    found = assert_contract(client.get("/search", params={"q": "onboarding weeks", "project_id": INTERNAL}), "GET", "/search")
    assert found["results"] and {r["doc_id"] for r in found["results"]} == {"internal/analyst-handbook"}
    assert client.get("/facts", params={"project_id": "nope"}).status_code == 422

    assert ask(client, Q, project_id=CLEARPATH)["binding"]["id"] == "M-106"
    inside = ask(client, "What is the target time for onboarding new analysts?", project_id=INTERNAL)
    assert inside["binding"]["id"] == "M-905" and inside["binding"]["project_id"] == INTERNAL
    assert not [f for f in inside["superseded"] + inside["conflicts"] if f["project_id"] != INTERNAL]
    blind = ask(client, "How long does a report spend in the audit queue?", project_id=INTERNAL)
    assert blind["status"] == "no_answer"
    assert ask(client, Q)["binding"]["id"] == "M-106"
    assert client.post("/ask", json={"question": Q, "project_id": "nope"}).status_code == 422
    assert client.post("/ask", json={"question": Q, "project_id": INTERNAL, "topic": "onboarding-target"}).status_code == 422

    client.post("/facts/M-905/retire", json={"reason": "Outdated.", "actor": "Giulia"})
    assert [e["fact_id"] for e in client.get("/audit", params={"project_id": INTERNAL}).json()] == ["M-905"]
    assert "M-905" not in [e["fact_id"] for e in client.get("/audit", params={"project_id": CLEARPATH}).json()]


def test_mail_config_is_inherited_and_can_be_overridden(client):
    assert assert_contract(client.get("/org/mail"), "GET", "/org/mail") == ORG_MAIL
    inherited = assert_contract(client.get(f"/projects/{CLEARPATH}/mail"), "GET", "/projects/{project_id}/mail")
    assert inherited == {"project_id": CLEARPATH, "overridden": False, "effective_mail_config": ORG_MAIL, "mail_config_override": None}
    own = assert_contract(client.get(f"/projects/{INTERNAL}/mail"), "GET", "/projects/{project_id}/mail")
    assert own["overridden"] is True and own["effective_mail_config"]["mode"] == "webhook"
    assert own["effective_mail_config"]["inbound_address"] == "internal@inbound.meridianlabs.org"

    changed = {**ORG_MAIL, "imap_user": "memory@meridianlabs.org", "password": "demo-only"}
    saved = assert_contract(client.put("/org/mail", json=changed), "PUT", "/org/mail")
    assert saved["imap_user"] == "memory@meridianlabs.org" and "password" not in saved
    assert client.get(f"/projects/{CLEARPATH}/mail").json()["effective_mail_config"]["imap_user"] == "memory@meridianlabs.org"
    assert client.get(f"/projects/{INTERNAL}/mail").json()["effective_mail_config"]["mode"] == "webhook"

    override = {"mode": "webhook", "inbound_address": "clearpath@inbound.meridianlabs.org", "poll_interval_s": 60}
    put = assert_contract(client.put(f"/projects/{CLEARPATH}/mail", json=override), "PUT", "/projects/{project_id}/mail")
    assert put["overridden"] is True and put["effective_mail_config"]["inbound_address"] == "clearpath@inbound.meridianlabs.org"
    assert client.get(f"/projects/{CLEARPATH}").json()["mail_config_override"]["mode"] == "webhook"
    back = assert_contract(client.delete(f"/projects/{CLEARPATH}/mail"), "DELETE", "/projects/{project_id}/mail")
    assert back["overridden"] is False and back["effective_mail_config"]["imap_user"] == "memory@meridianlabs.org"
    assert_contract(client.get("/projects/nope/mail"), "GET", "/projects/{project_id}/mail", 404)
    assert_contract(client.put("/org/mail", json={"mode": "pigeon"}), "PUT", "/org/mail", 422)
    assert "password" not in str(client.get("/export").json().get("org", ""))


def test_routing_rules_match_by_priority(client):
    rules = client.get("/org/mail/rules").json()["items"]
    assert [r["id"] for r in rules] == ["rule-001", "rule-002"]
    check = lambda **changes: assert_contract(client.post("/org/mail/rules/test", json={**EMAIL, **changes}), "POST", "/org/mail/rules/test")  # noqa: E731
    assert check() == {"matched": True, "routed_project_id": CLEARPATH, "rule_id": "rule-001", "reason": "sender_domain @meridianlabs.org"}
    assert check(**{"from": "ops@team.meridianlabs.org"})["routed_project_id"] == INTERNAL
    nobody = check(**{"from": "news@vendor.example"})
    assert nobody["matched"] is False and nobody["routed_project_id"] is None and nobody["rule_id"] is None

    by_subject = assert_contract(client.post("/org/mail/rules", json={"match_type": "subject_contains", "value": "handbook", "project_id": INTERNAL, "priority": 5}), "POST", "/org/mail/rules", 201)
    assert by_subject["id"] == "rule-003"
    assert check(subject="New handbook chapter")["rule_id"] == "rule-003"
    by_recipient = client.post("/org/mail/rules", json={"match_type": "recipient", "value": "internal@inbound.meridianlabs.org", "project_id": INTERNAL}).json()
    assert by_recipient["priority"] == 100
    assert check(to=["internal@inbound.meridianlabs.org"])["rule_id"] == "rule-001"
    assert_contract(client.patch(f"/org/mail/rules/{by_recipient['id']}", json={"priority": 1}), "PATCH", "/org/mail/rules/{rule_id}")
    assert check(to=["internal@inbound.meridianlabs.org"])["rule_id"] == by_recipient["id"]
    by_address = client.post("/org/mail/rules", json={"match_type": "sender_address", "value": "client@meridianlabs.org", "project_id": INTERNAL, "priority": 0}).json()
    assert check()["rule_id"] == by_address["id"]
    assert client.delete(f"/org/mail/rules/{by_address['id']}").json() == {"id": by_address["id"], "deleted": True}
    assert check()["rule_id"] == "rule-001"
    assert_contract(client.post("/org/mail/rules", json={"match_type": "sender_domain", "value": "@meridianlabs.org", "project_id": CLEARPATH}), "POST", "/org/mail/rules", 409)
    assert_contract(client.post("/org/mail/rules", json={"match_type": "sender_domain", "value": "@x.org", "project_id": "nope"}), "POST", "/org/mail/rules", 404)
    assert_contract(client.patch("/org/mail/rules/rule-999", json={"priority": 1}), "PATCH", "/org/mail/rules/{rule_id}", 404)
    assert_contract(client.delete("/org/mail/rules/rule-999"), "DELETE", "/org/mail/rules/{rule_id}", 404)
    assert client.get("/messages").status_code == 404 and client.get("/facts", params={"limit": 500}).json()["total"] == 432


def test_demo_email_changes_the_answer_end_to_end(client):
    before = ask(client, Q)
    assert before["binding"]["id"] == "M-106"
    result = assert_contract(client.post("/demo/send-email"), "POST", "/demo/send-email")
    assert result["message_id"] == "<demo-0001@meridianlabs.org>" and result["routed_project_id"] == CLEARPATH and result["rule_id"] == "rule-001"
    assert result["document_id"] == "mail/demo-0001" and result["facts_created"] == ["E-301"]
    assert result["supersedes_created"] == [{"fact_id": "E-301", "supersedes": "M-106"}]

    fact = client.get("/facts/E-301").json()
    assert (fact["value"], fact["type"], fact["doc_id"], fact["supersedes"], fact["project_id"]) == ("Onboarding time: 5 weeks", "DECISION", "mail/demo-0001", "M-106", CLEARPATH)
    assert fact["quote"] == "Following our call, we confirm the onboarding target at 5 weeks."
    old = client.get("/facts/M-106").json()
    assert old["superseded_by"] == "E-301" and old["type"] == "SUPERSEDED" and old["status"] == "active"
    document = client.get("/documents/mail%2Fdemo-0001").json()
    assert fact["quote"] in document["text"] and document["project_id"] == CLEARPATH and document["source_id"] == "src-clearpath-mail"

    after = ask(client, Q)
    assert after["status"] == "binding" and after["binding"]["id"] == "E-301" and after["binding"]["doc_id"] == "mail/demo-0001"
    assert after["answer"].startswith("5 weeks") and "email from client@meridianlabs.org" in after["answer"]
    assert after["changed_because"] == "an email from client@meridianlabs.org replaced 3–4 weeks (final report)"
    assert "M-106" in [f["id"] for f in after["superseded"]]
    assert {"doc_id": "mail/demo-0001", "quote": fact["quote"]} in after["citations"]

    event = client.get("/audit", params={"fact_id": "E-301"}).json()[0]
    assert event["id"] == result["audit_event_id"] and event["action"] == "supersede" and event["project_id"] == CLEARPATH
    messages = assert_contract(client.get(f"/projects/{CLEARPATH}/messages"), "GET", "/projects/{project_id}/messages")
    assert messages["total"] == 1 and messages["items"][0]["document_id"] == "mail/demo-0001"
    assert client.get(f"/projects/{INTERNAL}/messages").json()["total"] == 0
    assert client.get("/sources/src-clearpath-mail").json()["items"] == 1
    assert_contract(client.post("/demo/send-email"), "POST", "/demo/send-email", 409)

    undo = client.post(f"/audit/{result['audit_event_id']}/undo", json={"actor": "Giulia", "reason": "Wrong email."})
    assert undo.status_code == 200 and client.get("/facts/E-301").status_code == 404
    restored = client.get("/facts/M-106").json()
    assert restored["superseded_by"] is None and restored["type"] == "DECISION"
    assert ask(client, Q)["binding"]["id"] == "M-106"

    client.post("/demo/reset")
    assert ask(client, Q) == before
    assert client.post("/demo/send-email").status_code == 200


def test_inbound_webhook_and_mock_inbox(client):
    stored = assert_contract(client.post("/mail/inbound", json=EMAIL), "POST", "/mail/inbound")
    assert stored["routed_project_id"] == CLEARPATH and stored["facts_created"] == [] and stored["supersedes_created"] == []
    assert stored["document_id"] == "mail/x-1" and stored["audit_event_id"]
    assert_contract(client.post("/mail/inbound", json=EMAIL), "POST", "/mail/inbound", 409)
    assert_contract(client.post("/mail/inbound", json={"subject": "x"}), "POST", "/mail/inbound", 422)
    stray = client.post("/mail/inbound", json={**EMAIL, "message_id": "<n-9@vendor.example>", "from": "news@vendor.example"}).json()
    assert stray["routed_project_id"] is None and stray["rule_id"] is None
    assert client.get("/documents/" + stray["document_id"].replace("/", "%2F")).json()["project_id"] is None
    assert stray["document_id"] not in [d["id"] for d in client.get("/documents", params={"project_id": CLEARPATH}).json()]

    decided = client.post("/mail/inbound", json={**EMAIL, "message_id": "<x-2@meridianlabs.org>", "text": "We agreed: the onboarding target is now 6 weeks."}).json()
    assert decided["facts_created"] == ["E-301"] and decided["supersedes_created"][0]["supersedes"] == "M-106"

    client.post("/demo/reset")
    assert assert_contract(client.post("/mail/poll", json={"project_id": INTERNAL}), "POST", "/mail/poll") == {"polled": 0, "results": []}
    polled = assert_contract(client.post("/mail/poll", json={"project_id": CLEARPATH}), "POST", "/mail/poll")
    assert polled["polled"] == 1 and polled["results"][0]["message_id"] == "<status-0046@meridianlabs.org>"
    assert polled["results"][0]["routed_project_id"] == CLEARPATH and polled["results"][0]["facts_created"] == []
    assert client.post("/mail/poll").json() == {"polled": 0, "results": []}
    assert_contract(client.post("/mail/poll", json={"project_id": "nope"}), "POST", "/mail/poll", 404)
    assert ask(client, Q)["binding"]["id"] == "M-106"


def test_new_library_version_supersedes_the_previous_one(client):
    doc = "/documents/library%2Fonboarding-standard"
    question = "What does the onboarding standard say?"
    first = ask(client, question, project_id=CLEARPATH)
    assert first["binding"]["id"] == "L-401" and [f["id"] for f in first["superseded"]] == ["L-400"]
    versions = assert_contract(client.get(doc + "/versions"), "GET", "/documents/{doc_id}/versions")
    assert [(v["version"], v["version_label"], v["facts_superseded"]) for v in versions] == [(1, "v1", []), (2, "v2", ["L-400"])]
    assert versions[1]["supersedes_document_id"] == "library/onboarding-standard" and versions[0]["supersedes_document_id"] is None

    text = client.get(doc).json()["text"].replace("Version 2", "Version 3").replace("3–4 weeks", "5 weeks")
    result = assert_contract(client.post(doc + "/versions", json={"version_label": "v3", "text": text}), "POST", "/documents/{doc_id}/versions", 201)
    assert result["version"]["version"] == 3 and result["version"]["facts_superseded"] == ["L-401"]
    assert result["facts_created"] == ["L-402"] and result["supersedes_created"] == [{"fact_id": "L-402", "supersedes": "L-401"}]
    new = client.get("/facts/L-402").json()
    assert (new["value"], new["type"], new["supersedes"], new["doc_id"]) == ("Onboarding standard v3: 5 weeks", "DECISION", "L-401", "library/onboarding-standard")
    assert new["quote"] == "Onboarding target: 5 weeks to autonomy."
    old = client.get("/facts/L-401").json()
    assert old["type"] == "SUPERSEDED" and old["superseded_by"] == "L-402" and old["status"] == "active"
    events = client.get("/audit", params={"fact_id": "L-402"}).json()
    assert events[0]["action"] == "supersede" and "Onboarding standard v3 supersedes L-401" in events[0]["reason"]

    after = ask(client, question, project_id=CLEARPATH)
    assert after["binding"]["id"] == "L-402" and after["answer"].startswith("5 weeks")
    assert [f["id"] for f in after["superseded"]] == ["L-400", "L-401"]
    assert after["changed_because"] == "version 3 of “Onboarding standard” replaced 3–4 weeks (onboarding standard v2)"
    current = client.get(doc).json()
    assert current["version"] == 3 and "5 weeks" in current["text"] and current["version_of"] == "library/onboarding-standard"
    assert len(client.get(doc + "/versions").json()) == 3
    assert ask(client, Q)["binding"]["id"] == "M-106"

    assert_contract(client.post(doc + "/versions", json={"version_label": "v4", "text": text}), "POST", "/documents/{doc_id}/versions", 409)
    assert_contract(client.post(doc + "/versions", json={"version_label": "v3", "text": text + "\\nMore."}), "POST", "/documents/{doc_id}/versions", 409)
    assert_contract(client.post(doc + "/versions", json={}), "POST", "/documents/{doc_id}/versions", 422)
    assert_contract(client.post("/documents/nope/versions", json={"text": "x"}), "POST", "/documents/{doc_id}/versions", 404)
    assert_contract(client.get("/documents/nope/versions"), "GET", "/documents/{doc_id}/versions", 404)


def test_new_version_of_a_corpus_document_matches_the_contract_example(client):
    doc = "/documents/07-documents%2Freport-final"
    assert [v["version"] for v in client.get(doc + "/versions").json()] == [1]
    result = assert_contract(client.post(doc + "/versions", json={"version_label": "v2", "text": "Onboarding SLA: 5 weeks."}), "POST", "/documents/{doc_id}/versions", 201)
    assert result["version"]["version"] == 2 and result["version"]["facts_superseded"] == ["M-106"]
    assert result["facts_created"] == ["M-301"] and result["supersedes_created"] == [{"fact_id": "M-301", "supersedes": "M-106"}]
    answer = ask(client, Q)
    assert answer["binding"]["id"] == "M-301" and answer["binding"]["value"].endswith("5 weeks")


def test_sources_and_github_sync(client, monkeypatch, spec):
    listed = assert_contract(client.get(f"/projects/{CLEARPATH}/sources"), "GET", "/projects/{project_id}/sources")["items"]
    assert {s["id"]: (s["type"], s["items"]) for s in listed} == {"src-clearpath-docs": ("documents", 46), "src-clearpath-library": ("document_library", 2), "src-clearpath-mail": ("mail", 0)}
    assert_contract(client.get("/projects/nope/sources"), "GET", "/projects/{project_id}/sources", 404)
    seeded = assert_contract(client.get("/sources/src-internal-gh"), "GET", "/sources/{source_id}")
    assert seeded["config"] == {"repo_url": "https://github.com/gabry-ts/canonico", "include": ["issues", "readme"]}

    body = spec["paths"]["/projects/{project_id}/sources"]["post"]["requestBody"]["content"]["application/json"]["example"]
    created = assert_contract(client.post(f"/projects/{CLEARPATH}/sources", json=body), "POST", "/projects/{project_id}/sources", 201)
    assert created["id"] == "src-clearpath-gh" and created["status"] == "idle" and created["items"] == 0 and created["last_synced_at"] is None
    assert_contract(client.post(f"/projects/{CLEARPATH}/sources", json=body), "POST", "/projects/{project_id}/sources", 409)
    assert_contract(client.post(f"/projects/{CLEARPATH}/sources", json={"type": "github", "label": "x", "config": {"repo_url": "https://example.com/a/b"}}), "POST", "/projects/{project_id}/sources", 422)
    assert_contract(client.post(f"/projects/{CLEARPATH}/sources", json={"type": "document_library", "label": "Drive", "config": {"provider": "google_drive", "root_path": "/"}}), "POST", "/projects/{project_id}/sources", 422)
    assert_contract(client.post("/projects/nope/sources", json=body), "POST", "/projects/{project_id}/sources", 404)
    renamed = assert_contract(client.patch("/sources/src-clearpath-gh", json={"label": "Tooling"}), "PATCH", "/sources/{source_id}")
    assert renamed["label"] == "Tooling"

    calls = []

    def fake_fetch(repo_url, include=None, limit=30, offline=False):
        calls.append((repo_url, offline))
        return [
            {"id": "github/meridianlabs/clearpath-tooling/readme", "title": "meridianlabs/clearpath-tooling README", "date": "2026-11-14", "path": "github/meridianlabs/clearpath-tooling/README.md", "text": "# Tooling\nScripts for the engagement."},
            {"id": "github/meridianlabs/clearpath-tooling/issues/7", "title": "#7 Export fails", "date": "2026-11-10", "path": "github/meridianlabs/clearpath-tooling/issues/7", "text": "#7 Export fails\nState: open\n\nThe export times out."},
        ]

    monkeypatch.setattr(github, "fetch", fake_fetch)
    job = assert_contract(client.post("/sources/src-clearpath-gh/sync"), "POST", "/sources/{source_id}/sync", 202)
    assert job["id"] == "sync-0001" and job["source_id"] == "src-clearpath-gh"
    done = wait_sync(client, job["id"])
    assert done["status"] == "done" and done["items_added"] == 2 and done["facts_created"] == 0 and done["finished_at"]
    source = client.get("/sources/src-clearpath-gh").json()
    assert source["status"] == "ok" and source["items"] == 2 and source["last_synced_at"]
    issue = client.get("/documents/github%2Fmeridianlabs%2Fclearpath-tooling%2Fissues%2F7").json()
    assert issue["project_id"] == CLEARPATH and issue["source_id"] == "src-clearpath-gh" and "times out" in issue["text"]
    again = wait_sync(client, client.post("/sources/src-clearpath-gh/sync").json()["id"])
    assert again["items_added"] == 0
    assert calls[0] == ("https://github.com/meridianlabs/clearpath-tooling", False)

    def failing(*args, **kwargs):
        raise github.GithubError("GitHub rate limit reached, try again later")

    monkeypatch.setattr(github, "fetch", failing)
    failed = wait_sync(client, client.post("/sources/src-clearpath-gh/sync").json()["id"])
    assert failed["status"] == "error" and client.get("/sources/src-clearpath-gh").json()["status"] == "error"

    mail = wait_sync(client, client.post("/sources/src-clearpath-mail/sync").json()["id"])
    assert mail["status"] == "done" and mail["items_added"] == 1
    assert wait_sync(client, client.post("/sources/src-clearpath-docs/sync").json()["id"])["items_added"] == 0
    assert client.delete("/sources/src-clearpath-gh").json() == {"id": "src-clearpath-gh", "deleted": True}
    assert client.get("/documents/github%2Fmeridianlabs%2Fclearpath-tooling%2Fissues%2F7").json()["source_id"] is None
    assert_contract(client.get("/sources/nope"), "GET", "/sources/{source_id}", 404)
    assert_contract(client.post("/sources/nope/sync"), "POST", "/sources/{source_id}/sync", 404)
    assert_contract(client.get("/sync-jobs/sync-9999"), "GET", "/sync-jobs/{job_id}", 404)


def test_github_urls_and_documents():
    assert github.parse_repo("https://github.com/gabry-ts/canonico") == ("gabry-ts", "canonico")
    assert github.parse_repo("https://github.com/gabry-ts/canonico.git/") == ("gabry-ts", "canonico")
    for bad in ("https://gitlab.com/a/b", "github.com/a/b", "https://github.com/a"):
        try:
            github.parse_repo(bad)
        except github.GithubError:
            continue
        raise AssertionError(bad)
    issues = [{"number": 3, "title": "Bug", "state": "open", "labels": [{"name": "build"}], "user": {"login": "someone"}, "created_at": "2026-11-01T10:00:00Z", "body": "Text"},
              {"number": 4, "title": "PR", "state": "open", "labels": [], "user": {"login": "someone"}, "created_at": "2026-11-02T10:00:00Z", "body": "", "pull_request": {}}]
    docs = github._documents("a", "b", None, issues, ["issues", "readme"])
    assert [d["id"] for d in docs] == ["github/a/b/issues/3"] and docs[0]["date"] == "2026-11-01" and "Labels: build" in docs[0]["text"]


def test_deleting_a_project_removes_its_memory_and_rules(client):
    client.post("/org/mail/rules", json={"match_type": "subject_contains", "value": "handbook", "project_id": INTERNAL})
    assert client.delete(f"/projects/{INTERNAL}").json() == {"id": INTERNAL, "deleted": True}
    assert client.get("/facts/M-905").status_code == 404
    assert client.get("/documents/internal%2Fanalyst-handbook").status_code == 404
    assert [r["project_id"] for r in client.get("/org/mail/rules").json()["items"]] == [CLEARPATH]
    assert client.get("/sources/src-internal-gh").status_code == 404
    assert ask(client, Q)["binding"]["id"] == "M-106"
    client.post("/demo/reset")
    assert client.get("/facts/M-905").status_code == 200

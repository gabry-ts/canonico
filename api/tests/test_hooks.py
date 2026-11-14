"""Inbound webhooks, manual uploads, tag rules and tags."""

from tests.conftest import assert_contract

Q = "How long does onboarding take?"
CLEARPATH, INTERNAL = "proj-clearpath", "proj-internal"
ORG_TOKEN = {"X-Canonico-Token": "whsec_x7Kq2demo9f2a"}
PROJECT_TOKEN = {"X-Canonico-Token": "whsec_clearpathdemo51c7"}
MEETING = {
    "type": "meeting",
    "title": "Steering committee 12 Nov",
    "date": "2026-11-12T10:00:00Z",
    "text": "We agreed the onboarding target stays at 3–4 weeks.",
    "tags": ["clearpath", "topic:onboarding-target"],
    "participants": ["Sara Conti", "Marco Bianchi"],
}
HOOK = "/hooks/projects/{project_id}"


def ask(client, question, **extra):
    return assert_contract(client.post("/ask", json={"question": question, **extra}), "POST", "/ask")


def test_hooks_need_the_right_token(client):
    url = f"/hooks/projects/{CLEARPATH}"
    missing = assert_contract(client.post(url, json=MEETING), "POST", HOOK, 401)
    assert missing == {"code": "unauthorized", "message": "Invalid X-Canonico-Token."}
    assert_contract(client.post(url, json=MEETING, headers={"X-Canonico-Token": "whsec_wrong"}), "POST", HOOK, 401)
    assert_contract(client.post(url, json=MEETING, headers=ORG_TOKEN), "POST", HOOK, 401)
    assert_contract(client.post("/hooks/org", json=MEETING), "POST", "/hooks/org", 401)
    assert_contract(client.post("/hooks/org", json=MEETING, headers=PROJECT_TOKEN), "POST", "/hooks/org", 401)
    assert_contract(client.post(f"/hooks/projects/{INTERNAL}", json=MEETING, headers=PROJECT_TOKEN), "POST", HOOK, 401)
    assert_contract(client.post("/hooks/projects/nope", json=MEETING, headers=PROJECT_TOKEN), "POST", HOOK, 404)
    assert_contract(client.post(url, json={"type": "meeting"}, headers=PROJECT_TOKEN), "POST", HOOK, 422)
    assert client.get(f"/projects/{CLEARPATH}/items").json()["total"] == 0
    assert assert_contract(client.post(url, json=MEETING, headers=PROJECT_TOKEN), "POST", HOOK, 202)["routed_by"] == "url"


def test_demo_meeting_confirms_the_binding_fact_without_replacing_it(client):
    before = ask(client, Q)
    result = assert_contract(client.post("/hooks/org", json=MEETING, headers=ORG_TOKEN), "POST", "/hooks/org", 202)
    assert result["item_id"] == "itm-0001" and result["project_id"] == CLEARPATH
    assert (result["routed_by"], result["rule_id"]) == ("tag_rule", "tr-001")
    assert result["document_id"] == "hooks/meeting-2026-11-12-steering-committee"
    assert result["facts_created"] == ["M-301"] and result["supersedes_created"] == [] and result["duplicate"] is False

    fact = client.get("/facts/M-301").json()
    assert (fact["value"], fact["type"], fact["topic"], fact["date"], fact["project_id"]) == ("3–4 weeks", "DECISION", "onboarding-target", "2026-11-12", CLEARPATH)
    assert fact["quote"] == MEETING["text"] and fact["supersedes"] is None and fact["superseded_by"] is None
    assert fact["tags"] == ["clearpath", "topic:onboarding-target"]
    assert client.get("/facts/M-106").json()["superseded_by"] is None

    after = ask(client, Q)
    assert after["status"] == "binding" and after["binding"]["id"] == "M-106" and after["answer"].startswith("Three to four weeks")
    assert after["answer"].endswith("The meeting “Steering committee 12 Nov” confirms it.")
    assert [f["id"] for f in after["superseded"]] == [f["id"] for f in before["superseded"]]
    assert [f["id"] for f in after["conflicts"]] == ["M-105"]
    assert {"doc_id": result["document_id"], "quote": MEETING["text"]} in after["citations"]
    assert "M-301" in [f["id"] for f in client.get("/facts/M-106/dependents").json()["facts"]]
    assert [f["id"] for f in client.get("/topics/onboarding-target/chain").json()["facts"]][-2:] == ["M-106", "M-301"]
    assert client.get("/topics/onboarding-target/chain").json()["changes"] == 5
    assert "C-001" in [c["id"] for c in client.get("/conflicts").json()]
    event = client.get("/audit", params={"fact_id": "M-301"}).json()[0]
    assert event["id"] == result["audit_event_id"] and event["action"] == "ingest" and event["actor"] == "webhook"
    assert event["reason"] == "The meeting “Steering committee 12 Nov” confirms M-106 (3–4 weeks)."

    client.post("/demo/send-email")
    replaced = ask(client, Q)
    assert replaced["binding"]["id"] == "E-301" and {"M-106", "M-301"} <= {f["id"] for f in replaced["superseded"]}
    assert [f["id"] for f in replaced["conflicts"]] == ["M-105"]

    client.post("/demo/reset")
    assert ask(client, Q) == before and client.get("/facts/M-301").status_code == 404
    assert client.get(f"/projects/{CLEARPATH}/items").json()["total"] == 0


def test_org_hook_routes_by_project_then_tag_rule_else_unroutable(client):
    by_project = assert_contract(client.post("/hooks/org", json={**MEETING, "tags": [], "project_id": INTERNAL}, headers=ORG_TOKEN), "POST", "/hooks/org", 202)
    assert (by_project["project_id"], by_project["routed_by"], by_project["rule_id"]) == (INTERNAL, "project_id", None)
    assert [client.get(f"/facts/{i}").json()["project_id"] for i in by_project["facts_created"]] == [INTERNAL]
    by_tag = client.post("/hooks/org", json={**MEETING, "title": "Second meeting"}, headers=ORG_TOKEN).json()
    assert (by_tag["project_id"], by_tag["routed_by"], by_tag["rule_id"]) == (CLEARPATH, "tag_rule", "tr-001")
    lost = assert_contract(client.post("/hooks/org", json={**MEETING, "tags": ["unknown"]}, headers=ORG_TOKEN), "POST", "/hooks/org", 422)
    assert lost == {"code": "unroutable", "message": "No project_id and no tag rule matched the item."}
    assert_contract(client.post("/hooks/org", json={**MEETING, "project_id": "nope"}, headers=ORG_TOKEN), "POST", "/hooks/org", 404)

    rule = assert_contract(client.post("/org/tag-rules", json={"tag": "handbook", "project_id": INTERNAL, "priority": 5}), "POST", "/org/tag-rules", 201)
    assert rule == {"id": "tr-002", "tag": "handbook", "project_id": INTERNAL, "priority": 5}
    check = lambda tags: assert_contract(client.post("/org/tag-rules/test", json={"tags": tags}), "POST", "/org/tag-rules/test")  # noqa: E731
    assert check(["clearpath", "topic:onboarding-target"]) == {"project_id": CLEARPATH, "rule_id": "tr-001"}
    assert check(["clearpath", "handbook"]) == {"project_id": INTERNAL, "rule_id": "tr-002"}
    assert check(["none"]) == {"project_id": None, "rule_id": None}
    assert_contract(client.patch("/org/tag-rules/tr-002", json={"priority": 50}), "PATCH", "/org/tag-rules/{rule_id}")
    assert check(["clearpath", "handbook"])["rule_id"] == "tr-001"
    assert [r["id"] for r in assert_contract(client.get("/org/tag-rules"), "GET", "/org/tag-rules")["items"]] == ["tr-001", "tr-002"]
    assert_contract(client.post("/org/tag-rules", json={"tag": "clearpath", "project_id": INTERNAL}), "POST", "/org/tag-rules", 409)
    assert_contract(client.post("/org/tag-rules", json={"tag": "x", "project_id": "nope"}), "POST", "/org/tag-rules", 404)
    assert_contract(client.post("/org/tag-rules", json={"tag": "x", "project_id": INTERNAL}, headers={"X-Demo-Actor": "mem-sara-conti"}), "POST", "/org/tag-rules", 403)
    assert client.delete("/org/tag-rules/tr-002").json() == {"id": "tr-002", "deleted": True}
    assert_contract(client.delete("/org/tag-rules/tr-002"), "DELETE", "/org/tag-rules/{rule_id}", 404)
    assert_contract(client.patch("/org/tag-rules/tr-999", json={"priority": 1}), "PATCH", "/org/tag-rules/{rule_id}", 404)


def test_external_id_makes_a_hook_idempotent(client):
    url = f"/hooks/projects/{CLEARPATH}"
    item = {**MEETING, "external_id": "meet-2026-11-12-steerco"}
    first = client.post(url, json=item, headers=PROJECT_TOKEN).json()
    again = assert_contract(client.post(url, json=item, headers=PROJECT_TOKEN), "POST", HOOK, 202)
    assert again == {**first, "duplicate": True} and first["duplicate"] is False
    assert client.get(f"/projects/{CLEARPATH}/items").json()["total"] == 1
    assert len(client.get("/facts", params={"tag": "topic:onboarding-target"}).json()["items"]) == 1
    other = client.post(url, json={**item, "external_id": "another"}, headers=PROJECT_TOKEN).json()
    assert other["duplicate"] is False and other["item_id"] == "itm-0002" and other["document_id"].endswith("-2")


def test_topic_tag_forces_the_topic_and_a_decision_replaces_the_binding_fact(client):
    url = f"/projects/{CLEARPATH}/items"
    free = {"type": "note", "title": "Call with ClearPath ops", "date": "2026-11-13T16:00:00Z", "text": "They said it now takes 9 days.", "tags": ["clearpath"]}
    unfiled = assert_contract(client.post(url, json=free), "POST", "/projects/{project_id}/items", 202)
    assert unfiled["facts_created"] == [] and unfiled["routed_by"] == "project_id" and unfiled["document_id"] == "hooks/note-2026-11-13-call-with-clearpath-ops"
    forced = client.post(url, json={**free, "title": "Call two", "tags": ["topic:audit-queue-time"]}).json()
    assert client.get(f"/facts/{forced['facts_created'][0]}").json()["topic"] == "audit-queue-time"

    decided = client.post(url, json={"type": "ticket", "title": "Change request 7", "date": "2026-11-13T09:00:00Z", "text": "Approved: the onboarding target is 6 weeks.", "tags": ["topic:onboarding-target"]}).json()
    assert decided["supersedes_created"] == [{"fact_id": decided["facts_created"][0], "supersedes": "M-106"}]
    answer = ask(client, Q)
    assert answer["binding"]["id"] == decided["facts_created"][0] and answer["answer"].startswith("6 weeks")
    assert answer["changed_because"] is None or "Change request 7" in answer["changed_because"]
    assert client.get("/audit", params={"fact_id": decided["facts_created"][0]}).json()[0]["actor"] == "Giulia"
    ignored = client.post(url, json={**free, "title": "Call three", "tags": ["topic:not-a-topic"]}).json()
    assert ignored["facts_created"] == []


def test_version_of_makes_the_item_a_new_library_version(client):
    text = client.get("/documents/library%2Fonboarding-standard").json()["text"].replace("Version 2", "Version 3").replace("3–4 weeks", "5 weeks")
    item = {"type": "document", "title": "Onboarding standard", "date": "2026-11-14T09:00:00Z", "text": text, "version_of": "library/onboarding-standard", "tags": ["clearpath"]}
    result = assert_contract(client.post(f"/hooks/projects/{CLEARPATH}", json=item, headers=PROJECT_TOKEN), "POST", HOOK, 202)
    assert result["document_id"] == "library/onboarding-standard" and result["facts_created"] == ["L-402"]
    assert {"fact_id": "L-402", "supersedes": "L-401"} in result["supersedes_created"]
    assert [v["version"] for v in client.get("/documents/library%2Fonboarding-standard/versions").json()] == [1, 2, 3]
    assert client.get("/facts/L-402").json()["tags"] == ["clearpath"]
    assert ask(client, Q)["binding"]["id"] == "L-402"
    assert_contract(client.post(f"/hooks/projects/{CLEARPATH}", json={**item, "version_of": "library/nope"}, headers=PROJECT_TOKEN), "POST", HOOK, 404)
    assert_contract(client.post(f"/hooks/projects/{CLEARPATH}", json={**item, "version_of": "internal/analyst-handbook"}, headers=PROJECT_TOKEN), "POST", HOOK, 404)


def test_items_and_tags_stay_inside_their_project(client):
    client.post("/hooks/org", json=MEETING, headers=ORG_TOKEN)
    client.post(f"/projects/{INTERNAL}/items", json={"type": "note", "title": "Desk note", "date": "2026-11-13T08:00:00Z", "text": "Agreed: travel is booked 7 working days before departure.", "tags": ["internal", "topic:travel-booking"]})
    page = assert_contract(client.get(f"/projects/{CLEARPATH}/items"), "GET", "/projects/{project_id}/items")
    assert [i["title"] for i in page["items"]] == ["Steering committee 12 Nov"] and page["total"] == 1
    row = page["items"][0]
    assert (row["source_id"], row["facts_count"], row["routed_by"], row["type"]) == ("src-clearpath-hook", 1, "tag_rule", "meeting")
    assert row["participants"] == ["Sara Conti", "Marco Bianchi"]
    inside = client.get(f"/projects/{INTERNAL}/items").json()
    assert [i["title"] for i in inside["items"]] == ["Desk note"] and inside["items"][0]["source_id"] is None
    assert client.get(f"/projects/{CLEARPATH}/items", params={"type": "note"}).json()["total"] == 0
    assert client.get(f"/projects/{CLEARPATH}/items", params={"tag": "clearpath"}).json()["total"] == 1
    detail = assert_contract(client.get(f"/items/{row['id']}"), "GET", "/items/{item_id}")
    assert detail["text_excerpt"] == MEETING["text"] and detail["document_id"] == row["document_id"]
    assert_contract(client.get("/items/itm-9999"), "GET", "/items/{item_id}", 404)
    assert_contract(client.get("/projects/nope/items"), "GET", "/projects/{project_id}/items", 404)

    tags = assert_contract(client.get("/tags", params={"project_id": CLEARPATH}), "GET", "/tags")
    assert {t["tag"]: t["count"] for t in tags} == {"clearpath": 2, "topic:onboarding-target": 2}
    assert {t["tag"] for t in client.get("/tags", params={"project_id": INTERNAL}).json()} == {"internal", "topic:travel-booking"}
    assert {t["tag"] for t in client.get("/tags").json()} == {"clearpath", "topic:onboarding-target", "internal", "topic:travel-booking"}
    assert [f["project_id"] for f in client.get("/facts", params={"tag": "internal"}).json()["items"]] == [INTERNAL]
    assert client.get("/facts", params={"tag": "internal", "project_id": CLEARPATH}).json()["total"] == 0
    assert [d["id"] for d in assert_contract(client.get("/documents", params={"tag": "clearpath"}), "GET", "/documents")] == [row["document_id"]]
    found = assert_contract(client.get("/search", params={"q": "onboarding target weeks", "tag": "clearpath"}), "GET", "/search")
    assert found["results"] and {r["doc_id"] for r in found["results"]} == {row["document_id"]}
    assert ask(client, "How far in advance is travel booked?", project_id=INTERNAL)["binding"]["doc_id"].startswith("hooks/note-2026-11-13-desk-note")
    assert ask(client, Q, project_id=CLEARPATH)["binding"]["id"] == "M-106"


def test_webhook_sources_keep_their_secret_hidden(client):
    hooks = assert_contract(client.get("/org/hooks"), "GET", "/org/hooks")
    assert hooks["url"].endswith("/hooks/org") and hooks["secret_last4"] == "9f2a" and "secret" not in hooks
    seeded = client.get("/sources/src-clearpath-hook").json()
    assert seeded["type"] == "webhook" and seeded["config"] == {"url": seeded["config"]["url"], "secret_last4": "51c7", "default_tags": ["clearpath"]}
    assert seeded["config"]["url"].endswith(f"/hooks/projects/{CLEARPATH}")
    assert "whsec_" not in client.get("/export").text and "whsec_" not in client.get(f"/projects/{CLEARPATH}/sources").text

    created = assert_contract(client.post(f"/projects/{INTERNAL}/sources", json={"type": "webhook", "label": "Internal hook", "config": {"default_tags": ["internal"]}}), "POST", "/projects/{project_id}/sources", 201)
    secret = created["secret"]
    assert secret.startswith("whsec_") and created["config"]["secret_last4"] == secret[-4:] and created["id"] == "src-internal-hook"
    assert "secret" not in client.get("/sources/src-internal-hook").json()
    sent = client.post(f"/hooks/projects/{INTERNAL}", json={**MEETING, "tags": []}, headers={"X-Canonico-Token": secret})
    assert sent.status_code == 202 and client.get(f"/items/{sent.json()['item_id']}").json()["tags"] == ["internal"]

    rotated = assert_contract(client.post("/sources/src-internal-hook/rotate-secret"), "POST", "/sources/{source_id}/rotate-secret")
    assert rotated["secret"] != secret and rotated["secret_last4"] == rotated["secret"][-4:]
    assert client.post(f"/hooks/projects/{INTERNAL}", json=MEETING, headers={"X-Canonico-Token": secret}).status_code == 401
    assert client.post(f"/hooks/projects/{INTERNAL}", json={**MEETING, "title": "Again"}, headers={"X-Canonico-Token": rotated["secret"]}).status_code == 202
    assert_contract(client.post("/sources/src-clearpath-docs/rotate-secret"), "POST", "/sources/{source_id}/rotate-secret", 409)
    assert_contract(client.post("/sources/nope/rotate-secret"), "POST", "/sources/{source_id}/rotate-secret", 404)
    assert_contract(client.post("/sources/src-internal-hook/rotate-secret", headers={"X-Demo-Actor": "mem-sara-conti"}), "POST", "/sources/{source_id}/rotate-secret", 403)

    org = assert_contract(client.post("/org/hooks/rotate-secret"), "POST", "/org/hooks/rotate-secret")
    assert client.post("/hooks/org", json=MEETING, headers=ORG_TOKEN).status_code == 401
    assert client.post("/hooks/org", json=MEETING, headers={"X-Canonico-Token": org["secret"]}).status_code == 202
    assert client.get("/org/hooks").json()["secret_last4"] == org["secret_last4"]
    assert_contract(client.post("/org/hooks/rotate-secret", headers={"X-Demo-Actor": "mem-luca-bassi"}), "POST", "/org/hooks/rotate-secret", 403)
    client.post("/demo/reset")
    assert client.post("/hooks/org", json=MEETING, headers=ORG_TOKEN).status_code == 202


def test_manual_upload_accepts_a_file_with_metadata(client):
    url = f"/projects/{CLEARPATH}/items"
    metadata = '{"type":"document","title":"Onboarding plan v2","date":"2026-11-13T09:00:00Z","tags":["clearpath","topic:onboarding-target"]}'
    upload = client.post(url, data={"metadata": metadata}, files={"file": ("plan.md", "# Plan\n\nWe confirm the onboarding target at 3–4 weeks.\n".encode(), "text/markdown")})
    result = assert_contract(upload, "POST", "/projects/{project_id}/items", 202)
    assert result["routed_by"] == "project_id" and len(result["facts_created"]) == 1
    assert client.get(f"/facts/{result['facts_created'][0]}").json()["quote"] == "We confirm the onboarding target at 3–4 weeks."
    assert ask(client, Q)["binding"]["id"] == "M-106"
    broken = client.post(url, data={"metadata": metadata}, files={"file": ("plan.docx", b"PK\x03\x04binary", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    assert broken.status_code == 422 and "DOCX" in broken.json()["message"]
    refused = client.post(url, data={"metadata": metadata}, files={"file": ("clip.mp4", b"\x00\x01", "video/mp4")})
    assert refused.status_code == 415 and refused.json()["code"] == "unsupported_media_type"
    assert client.post(url, data={"metadata": "{not json"}, files={"file": ("a.txt", b"x", "text/plain")}).status_code == 422
    assert_contract(client.post(url, json={"type": "note", "title": "Empty", "date": "2026-11-13T09:00:00Z"}), "POST", "/projects/{project_id}/items", 422)
    assert_contract(client.post(url, json={"type": "note", "title": "Link", "date": "2026-11-13T09:00:00Z", "file_url": "ftp://files.example.org/a.txt"}), "POST", "/projects/{project_id}/items", 422)
    assert_contract(client.post("/projects/nope/items", json=MEETING), "POST", "/projects/{project_id}/items", 404)


def docx_bytes(*paragraphs: str) -> bytes:
    import io

    import docx

    document = docx.Document()
    for paragraph in paragraphs:
        document.add_paragraph(paragraph)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def test_docx_uploads_are_read(client):
    metadata = '{"type":"document","title":"Onboarding plan v3","date":"2026-11-13T09:00:00Z","tags":["topic:onboarding-target"]}'
    data = docx_bytes("Onboarding plan", "Approved: the onboarding target is 6 weeks.")
    upload = client.post(f"/projects/{CLEARPATH}/items", data={"metadata": metadata}, files={"file": ("plan.docx", data, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    result = assert_contract(upload, "POST", "/projects/{project_id}/items", 202)
    fact = client.get(f"/facts/{result['facts_created'][0]}").json()
    assert fact["quote"] == "Approved: the onboarding target is 6 weeks." and fact["supersedes"] == "M-106"
    document = client.post("/documents", data={"title": "Word note", "date": "2026-11-13", "ingest": "false"}, files={"file": ("note.docx", docx_bytes("First line", "Second line"), "application/octet-stream")})
    assert document.status_code == 201
    assert client.get("/documents/word-note").json()["text"] == "First line\nSecond line"


def test_file_url_is_fetched_with_limits(client, monkeypatch):
    import httpx

    from app import files

    served = {
        "/plan.md": (200, {"content-type": "text/markdown; charset=utf-8"}, "We confirm the onboarding target at 3–4 weeks.".encode()),
        "/plan.docx": (200, {"content-type": files.DOCX}, docx_bytes("Approved: the onboarding target is 7 weeks.")),
        "/raw.txt": (200, {"content-type": "application/octet-stream"}, b"Nothing to decide."),
        "/page.html": (200, {"content-type": "text/html"}, b"<html></html>"),
        "/clip": (200, {"content-type": "video/mp4"}, b"\x00"),
        "/huge.txt": (200, {"content-type": "text/plain"}, b"x" * (files.MAX_BYTES + 1)),
        "/moved": (302, {"location": "/plan.md"}, b""),
        "/inside": (302, {"location": "http://internal.test/secret.txt"}, b""),
        "/gone.txt": (404, {"content-type": "text/plain"}, b"no"),
    }
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if request.url.path == "/slow.txt":
            raise httpx.ReadTimeout("slow", request=request)
        status, headers, body = served[request.url.path]
        return httpx.Response(status, headers=headers, content=body)

    monkeypatch.setattr(files, "_client", lambda: httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False))
    monkeypatch.setattr(files, "_public_host", lambda host: host == "files.example.org")
    url = f"/projects/{CLEARPATH}/items"
    item = {"type": "document", "title": "Linked plan", "date": "2026-11-13T09:00:00Z", "tags": ["topic:onboarding-target"]}

    linked = assert_contract(client.post(url, json={**item, "file_url": "https://files.example.org/plan.md"}), "POST", "/projects/{project_id}/items", 202)
    assert client.get(f"/facts/{linked['facts_created'][0]}").json()["quote"] == "We confirm the onboarding target at 3–4 weeks."
    assert client.post(url, json={**item, "title": "Moved plan", "file_url": "https://files.example.org/moved"}).status_code == 202
    word = client.post(url, json={**item, "title": "Word plan", "file_url": "https://files.example.org/plan.docx"}).json()
    assert client.get(f"/facts/{word['facts_created'][0]}").json()["value"] == "7 weeks"
    assert client.post(url, json={**item, "title": "Raw", "file_url": "https://files.example.org/raw.txt"}).status_code == 202
    hooked = client.post(f"/hooks/projects/{CLEARPATH}", json={**item, "title": "Hooked", "file_url": "https://files.example.org/raw.txt"}, headers=PROJECT_TOKEN)
    assert hooked.status_code == 202

    for path, words in (("/page.html", "content type text/html"), ("/clip", "content type video/mp4"), ("/huge.txt", "larger than 10 MB"), ("/slow.txt", "longer than 15 seconds"), ("/gone.txt", "answered 404"), ("/inside", "not a public address")):
        refused = assert_contract(client.post(url, json={**item, "file_url": "https://files.example.org" + path}), "POST", "/projects/{project_id}/items", 422)
        assert words in refused["message"], refused
    assert "http and https" in client.post(url, json={**item, "file_url": "file:///etc/passwd"}).json()["message"]
    assert "not a public address" in client.post(url, json={**item, "file_url": "http://localhost:8000/health"}).json()["message"]
    assert not any("internal.test" in call or "localhost" in call for call in seen)

    before = len(seen)
    assert client.post(f"/hooks/projects/{CLEARPATH}", json={**item, "file_url": "https://files.example.org/plan.md"}, headers={"X-Canonico-Token": "wrong"}).status_code == 401
    assert len(seen) == before


def test_internal_addresses_are_not_public():
    from app import files

    for host in ("127.0.0.1", "localhost", "10.0.0.5", "192.168.1.10", "169.254.169.254", "::1"):
        assert files._public_host(host) is False, host

"""Scenario 8: human controls on facts that the model created."""

from tests_live.conftest import check_invariants, note

PROJECT = "proj-clearpath"
TOKEN = {"X-Canonico-Token": "whsec_clearpathdemo51c7"}
ACTOR = {"actor": "Giulia"}


def ask_topic(api, topic: str) -> dict:
    response = api.post("/ask", json={"question": "What was decided?", "topic": topic})
    assert response.status_code == 200, response.text
    return response.json()


def test_retire_restore_pin_unpin_correct_and_undo(api, request):
    text = (
        "Vendor selection board, final session.\n"
        "Decision: the shortlist for the document management platform is reduced to Alpha Systems and Beta Works; Gamma Soft is excluded.\n"
        "Decision: Alpha Systems is the preferred vendor, pending the security review.\n"
        "Open question: nobody knows yet who owns the data migration."
    )
    result = api.post(f"/hooks/projects/{PROJECT}", json={"type": "meeting", "title": "Vendor selection board", "date": "2026-11-12T10:00:00Z", "text": text}, headers=TOKEN).json()
    facts = [api.get(f"/facts/{i}").json() for i in result["facts_created"]]
    note(request, "created", [{k: f[k] for k in ("id", "topic", "value", "type")} for f in facts])
    assert facts, "model created no facts"
    target = facts[0]
    topic = target["topic"]
    steps = []
    if target["type"] not in ("DECISION", "CONSTRAINT"):
        response = api.patch(f"/facts/{target['id']}", json={"type": "DECISION", "reason": "It is a decision.", **ACTOR})
        assert response.status_code == 200, response.text
    first = ask_topic(api, topic)
    answer_id = first["answer_id"]
    steps.append(("start", (first["binding"] or {}).get("id")))

    assert api.post(f"/facts/{target['id']}/retire", json={"reason": "Wrong reading.", **ACTOR}).status_code == 200
    retired = ask_topic(api, topic)
    steps.append(("retired", (retired["binding"] or {}).get("id")))
    assert (retired["binding"] or {}).get("id") != target["id"]
    assert not check_invariants(api)

    assert api.post(f"/facts/{target['id']}/restore", json={"reason": "Right after all.", **ACTOR}).status_code == 200
    restored = ask_topic(api, topic)
    steps.append(("restored", (restored["binding"] or {}).get("id")))
    assert (restored["binding"] or {}).get("id") == (first["binding"] or {}).get("id")

    other = next((f for f in facts if f["topic"] == topic and f["id"] != target["id"]), None)
    pin_target = other or target
    assert api.post(f"/facts/{pin_target['id']}/pin", json={"reason": "Board says so.", **ACTOR}).status_code == 200
    pinned = ask_topic(api, topic)
    steps.append(("pinned", pinned["binding"]["id"]))
    assert pinned["binding"]["id"] == pin_target["id"]
    assert api.post(f"/facts/{target['id']}/pin", json={"reason": "Pin moves.", **ACTOR}).status_code == 200
    moved = [f for f in api.all_facts(topic=topic) if f["pinned"]]
    assert [f["id"] for f in moved] == [target["id"]]
    assert not check_invariants(api)
    assert api.post(f"/facts/{target['id']}/unpin", json={"reason": "Back to normal.", **ACTOR}).status_code == 200
    assert not [f for f in api.all_facts(topic=topic) if f["pinned"]]

    patched = api.patch(f"/facts/{target['id']}", json={"value": "Corrected by hand: Beta Works is the preferred vendor.", "reason": "Minutes were wrong.", **ACTOR})
    assert patched.status_code == 200, patched.text
    corrected = ask_topic(api, topic)
    steps.append(("patched", (corrected["binding"] or {}).get("value")))
    assert any("Beta Works is the preferred" in f["value"] for f in [corrected["binding"] or {}] + corrected["conflicts"] + corrected["superseded"] if f)

    replay = api.post(f"/answers/{answer_id}/replay").json()
    steps.append(("replay", replay["changed"]))
    assert replay["changed"] is True and replay["diffs"]

    events = api.get("/audit", params={"fact_id": target["id"], "limit": 50}).json()
    actions = [e["action"] for e in events]
    steps.append(("audit", actions))
    assert {"retire", "restore", "pin", "unpin"} <= set(actions)
    edit = events[0]
    undo = api.post(f"/audit/{edit['id']}/undo", json={"reason": "Undo the correction.", **ACTOR})
    assert undo.status_code == 200, undo.text
    back = api.get(f"/facts/{target['id']}").json()
    steps.append(("undone", back["value"]))
    note(request, "steps", steps)
    assert "Beta Works is the preferred" not in back["value"]
    assert not check_invariants(api)

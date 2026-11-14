"""Scenario 6: natural-language versions of a library document."""

import re

import pytest

from tests_live.conftest import FORCED, note

DOC = "library%2Fonboarding-standard"
STANDARD_Q = "What does the onboarding standard say?"

V3 = """Onboarding standard
Version 3, ClearPath Solutions
Owner: Operations

Following the 2026 review with the delivery leads, consultants are no longer expected to be fully autonomous after a month.
Target: new consultants should reach full autonomy within 5–6 weeks of their start date.

The shared curriculum stays as it is, with a senior consultant as buddy for the whole period.
"""

V4 = """Onboarding standard
Version 4, ClearPath Solutions
Owner: Operations

Editorial update, no change of substance: we confirm that the target for a new consultant to become fully autonomous remains 5–6 weeks.
The buddy system and the shared curriculum are unchanged.
"""


@pytest.mark.xfail(FORCED, reason="known: on the model path the new version's facts are filed by topic and linked by the model, which does not supersede the v2 fact of the standard", strict=False)
def test_v3_supersedes_the_previous_version_and_v4_confirms(api, request):
    before = api.ask(STANDARD_Q)
    v2_facts = [f for f in api.all_facts(doc_id="library/onboarding-standard") if f["status"] == "active" and not f["superseded_by"]]
    response = api.post(f"/documents/{DOC}/versions", json={"version_label": "v3", "date": "2026-11-14", "text": V3})
    assert response.status_code == 201, response.text
    v3 = response.json()
    after = api.ask(STANDARD_Q)
    onboarding = api.ask("How long does onboarding take?")
    note(request, "v3", {"result": v3, "before": (before["binding"] or {}).get("value"), "after": (after["binding"] or {}).get("value"), "onboarding_binding": onboarding["binding"]})
    assert v3["facts_created"], v3
    # links made by the rule are in the response, links made by the model come right after: read the facts
    replaced = {f["id"] for f in v2_facts if api.get(f"/facts/{f['id']}").json()["superseded_by"]}
    note(request, "v2_superseded", sorted(replaced))
    assert replaced, "v2 facts were not superseded"
    assert "5" in (after["binding"] or {}).get("value", "")

    response = api.post(f"/documents/{DOC}/versions", json={"version_label": "v4", "date": "2026-11-15", "text": V4})
    assert response.status_code == 201, response.text
    v4 = response.json()
    again = api.ask(STANDARD_Q)
    created = [api.get(f"/facts/{i}").json() for i in v4["facts_created"]]
    note(request, "v4", {"result": v4, "binding": (again["binding"] or {}).get("id"), "created": [{k: f[k] for k in ("id", "value", "type", "supersedes")} for f in created]})
    numbers = lambda fact: re.findall(r"\d+", (fact or {}).get("value", ""))
    assert numbers(again["binding"]) == numbers(after["binding"]), (again["binding"], after["binding"])

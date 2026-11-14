"""A new version of the onboarding standard written in plain words still replaces the onboarding time."""

import pytest

Q = "How long does onboarding take?"
STANDARD = "/documents/library%2Fonboarding-standard/versions"


@pytest.mark.parametrize(
    "text",
    [
        "Onboarding standard\nVersion 3\n\nWe are extending onboarding to 5 weeks.",
        "Onboarding standard\nVersion 3\n\nOnboarding should now take about five weeks for every new consultant.",
        "Onboarding standard\nVersion 3\n\nTarget: 5 weeks.",
    ],
)
def test_a_plainly_worded_new_version_replaces_the_onboarding_time(client, text):
    result = client.post(STANDARD, json={"text": text, "date": "2026-11-14"}).json()
    assert {link["supersedes"] for link in result["supersedes_created"]} >= {"M-106", "L-401"}
    assert client.post("/ask", json={"question": Q}).json()["binding"]["value"] == "5 weeks"
    assert "5 weeks" in client.post("/ask", json={"question": "What does the onboarding standard say?"}).json()["answer"]

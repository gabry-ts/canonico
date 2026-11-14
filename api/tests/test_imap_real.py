"""Real protocol round trip against a GreenMail container (SMTP in, IMAP out). Run with make test-docker.

Skipped when nothing listens on the GreenMail ports, so the regular suite stays offline.
"""

import smtplib
import socket
import uuid
from email.message import EmailMessage

import pytest

HOST = "127.0.0.1"
SMTP_PORT, IMAP_PORT = 3025, 3143
CLEARPATH = "proj-clearpath"
Q = "What is the onboarding target?"

pytestmark = pytest.mark.docker


def listening(port: int) -> bool:
    try:
        with socket.create_connection((HOST, port), timeout=1):
            return True
    except OSError:
        return False


@pytest.fixture()
def greenmail(client, monkeypatch):
    if not (listening(SMTP_PORT) and listening(IMAP_PORT)):
        pytest.skip("GreenMail is not running on ports 3025 and 3143")
    monkeypatch.setenv("CANONICO_IMAP_HOST", HOST)
    monkeypatch.setenv("CANONICO_IMAP_PORT", str(IMAP_PORT))
    monkeypatch.setenv("CANONICO_IMAP_USER", "brain")
    monkeypatch.setenv("CANONICO_IMAP_PASSWORD", "canonico-demo")
    monkeypatch.setenv("CANONICO_SMTP_HOST", HOST)
    monkeypatch.setenv("CANONICO_SMTP_PORT", str(SMTP_PORT))
    config = {"mode": "imap", "imap_host": HOST, "imap_user": "brain", "inbound_address": "brain@inbound.meridianlabs.org", "poll_interval_s": 60}
    assert client.put("/org/mail", json=config).status_code == 200
    client.post("/mail/poll")  # drain what earlier runs left unseen


def send(message_id: str, text: str) -> None:
    message = EmailMessage()
    message["From"] = "client@meridianlabs.org"
    message["To"] = "brain@inbound.meridianlabs.org"
    message["Subject"] = "Onboarding target confirmed"
    message["Message-ID"] = message_id
    message.set_content(text)
    with smtplib.SMTP(HOST, SMTP_PORT, timeout=10) as smtp:
        smtp.send_message(message)


def test_smtp_to_imap_supersedes_the_onboarding_target(client, greenmail):
    before = client.post("/ask", json={"question": Q}).json()
    assert before["binding"]["id"] == "M-106"
    message_id = f"<real-{uuid.uuid4().hex[:12]}@meridianlabs.org>"
    send(message_id, "Following our call, we confirm the onboarding target at 5 weeks.")

    polled = client.post("/mail/poll").json()
    assert [r["message_id"] for r in polled["results"]] == [message_id]
    assert polled["results"][0]["supersedes_created"][0]["supersedes"] == "M-106"
    after = client.post("/ask", json={"question": Q}).json()
    assert after["binding"]["doc_id"].startswith("mail/real-") and after["answer"].startswith("5 weeks")
    assert client.post("/mail/poll").json() == {"polled": 0, "results": []}


def test_demo_send_email_uses_real_smtp_and_imap(client, greenmail):
    result = client.post("/demo/send-email")
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["message_id"] == "<demo-0001@meridianlabs.org>" and body["routed_project_id"] == CLEARPATH
    assert body["supersedes_created"] == [{"fact_id": "E-301", "supersedes": "M-106"}]
    after = client.post("/ask", json={"question": Q}).json()
    assert after["answer"].startswith("5 weeks") and "email from client@meridianlabs.org" in after["answer"]
    assert client.post("/demo/send-email").status_code == 409

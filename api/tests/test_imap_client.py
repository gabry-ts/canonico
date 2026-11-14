"""The imap mail mode against a fake IMAP server: parsing, routing, supersession and idempotency."""

import io
from email.message import EmailMessage

import pytest

from app import imap_client

CLEARPATH = "proj-clearpath"
Q = "What is the onboarding target?"


def raw_mail(message_id: str, sender: str = "client@meridianlabs.org", text: str = "Following our call, we confirm the onboarding target at 5 weeks.", attachment: tuple[str, str, bytes] | None = None) -> bytes:
    message = EmailMessage()
    message["From"] = f"Client Person <{sender}>"
    message["To"] = "brain@inbound.meridianlabs.org"
    message["Cc"] = "pm@meridianlabs.org, Someone <else@example.com>"
    message["Subject"] = "Onboarding target confirmed"
    message["Message-ID"] = message_id
    message["Date"] = "Sat, 14 Nov 2026 14:30:00 +0100"
    message.set_content(text)
    if attachment:
        filename, content_type, data = attachment
        maintype, subtype = content_type.split("/")
        message.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)
    return message.as_bytes()


class FakeImap:
    """Just enough of imaplib.IMAP4 for the poll: one inbox, seen flags per uid."""

    messages: dict[bytes, bytes] = {}
    seen: set[bytes] = set()
    logins: list[tuple[str, str]] = []

    def __init__(self, host, port, timeout=None):
        self.address = (host, port)

    def login(self, user, password):
        self.logins.append((user, password))
        return "OK", [b"done"]

    def select(self, mailbox):
        return "OK", [b"1"]

    def uid(self, command, *args):
        if command == "SEARCH":
            return "OK", [b" ".join(u for u in sorted(self.messages) if u not in self.seen)]
        if command == "FETCH":
            return "OK", [(b"1 (UID 1 BODY[] {1}", self.messages[args[0]]), b")"]
        if command == "STORE":
            self.seen.add(args[0])
            return "OK", [b"done"]
        raise AssertionError(command)

    def logout(self):
        return "BYE", [b"bye"]


@pytest.fixture()
def fake(monkeypatch):
    FakeImap.messages, FakeImap.seen, FakeImap.logins = {}, set(), []
    monkeypatch.setenv("CANONICO_IMAP_HOST", "mail")
    monkeypatch.setenv("CANONICO_IMAP_PORT", "3143")
    monkeypatch.setenv("CANONICO_IMAP_USER", "brain")
    monkeypatch.setenv("CANONICO_IMAP_PASSWORD", "canonico-demo")
    monkeypatch.setattr(imap_client.imaplib, "IMAP4", FakeImap)
    return FakeImap


@pytest.fixture()
def imap_mode(client, fake):
    config = {"mode": "imap", "imap_host": "mail", "imap_user": "brain", "inbound_address": "brain@inbound.meridianlabs.org", "poll_interval_s": 60}
    assert client.put("/org/mail", json=config).json()["mode"] == "imap"
    return fake


def test_parse_headers_and_text():
    email = imap_client.parse(raw_mail("<a-1@meridianlabs.org>"))
    assert email["message_id"] == "<a-1@meridianlabs.org>"
    assert email["from"] == "client@meridianlabs.org"
    assert email["to"] == ["brain@inbound.meridianlabs.org"]
    assert email["cc"] == ["pm@meridianlabs.org", "else@example.com"]
    assert email["subject"] == "Onboarding target confirmed"
    assert email["date"] == "2026-11-14T13:30:00Z"
    assert email["text"] == "Following our call, we confirm the onboarding target at 5 weeks."


def test_parse_without_message_id_is_stable():
    raw = raw_mail("<x@y>").replace(b"Message-ID: <x@y>\r\n", b"").replace(b"Message-ID: <x@y>\n", b"")
    assert imap_client.parse(raw)["message_id"] == imap_client.parse(raw)["message_id"]
    assert imap_client.parse(raw)["message_id"].startswith("<sha1-")


def test_parse_html_only_and_attachments():
    message = EmailMessage()
    message["From"] = "a@b.org"
    message["Subject"] = "html"
    message.set_content("<p>Hello <b>team</b></p><script>x()</script>", subtype="html")
    assert imap_client.parse(message.as_bytes())["text"] == "Hello team"

    import docx

    document = docx.Document()
    document.add_paragraph("The pilot ends in week 9.")
    buffer = io.BytesIO()
    document.save(buffer)
    docx_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    email = imap_client.parse(raw_mail("<a-2@m>", attachment=("plan.docx", docx_type, buffer.getvalue())))
    assert email["attachments"] == [{"filename": "plan.docx", "text": "The pilot ends in week 9."}]
    email = imap_client.parse(raw_mail("<a-3@m>", attachment=("notes.txt", "text/plain", b"plain notes")))
    assert email["attachments"] == [{"filename": "notes.txt", "text": "plain notes"}]
    email = imap_client.parse(raw_mail("<a-4@m>", attachment=("photo.png", "image/png", b"\x89PNG")))
    assert email["attachments"] == []


def test_poll_runs_the_inbound_pipeline_and_marks_seen(client, imap_mode):
    imap_mode.messages[b"7"] = raw_mail("<real-1@meridianlabs.org>")
    before = client.post("/ask", json={"question": Q}).json()
    polled = client.post("/mail/poll").json()
    assert polled["polled"] == 1
    result = polled["results"][0]
    assert result["routed_project_id"] == CLEARPATH and result["rule_id"] == "rule-001"
    assert result["facts_created"] == ["E-301"] and result["supersedes_created"][0]["fact_id"] == "E-301"
    assert imap_mode.logins == [("brain", "canonico-demo")]
    assert imap_mode.seen == {b"7"}
    after = client.post("/ask", json={"question": Q}).json()
    assert after["binding"]["id"] == "E-301" and after["answer"].startswith("5 weeks")
    assert before["binding"]["id"] != "E-301"
    assert client.get(f"/projects/{CLEARPATH}/messages").json()["total"] == 1
    assert client.get("/audit", params={"fact_id": "E-301"}).json()[0]["action"] == "supersede"


def test_poll_is_idempotent_by_message_id(client, imap_mode):
    imap_mode.messages[b"1"] = raw_mail("<dup-1@meridianlabs.org>")
    assert client.post("/mail/poll").json()["polled"] == 1
    imap_mode.messages[b"2"] = raw_mail("<dup-1@meridianlabs.org>")
    again = client.post("/mail/poll").json()
    assert again["results"] == [] and imap_mode.seen == {b"1", b"2"}
    assert client.get(f"/projects/{CLEARPATH}/messages").json()["total"] == 1
    assert client.post("/mail/poll").json() == {"polled": 0, "results": []}


def test_project_poll_leaves_other_projects_unseen(client, imap_mode):
    imap_mode.messages[b"1"] = raw_mail("<own-1@team.meridianlabs.org>", sender="lead@team.meridianlabs.org", text="Nothing to extract.")
    imap_mode.messages[b"2"] = raw_mail("<own-2@meridianlabs.org>", text="Nothing to extract.")
    polled = client.post("/mail/poll", json={"project_id": CLEARPATH}).json()
    assert polled["polled"] == 1 and polled["results"][0]["message_id"] == "<own-2@meridianlabs.org>"
    assert imap_mode.seen == {b"2"}


def test_unreachable_mailbox_is_a_bad_gateway(client, imap_mode, monkeypatch):
    def refuse(*args, **kwargs):
        raise ConnectionRefusedError("down")

    monkeypatch.setattr(imap_client.imaplib, "IMAP4", refuse)
    assert client.post("/mail/poll").status_code == 502


def test_demo_send_goes_through_smtp_then_imap(client, imap_mode, monkeypatch):
    sent = []

    class FakeSmtp:
        def __init__(self, host, port, timeout=None):
            self.address = (host, port)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def send_message(self, message):
            sent.append((self.address, message))
            imap_mode.messages[b"1"] = message.as_bytes()

    monkeypatch.setattr(imap_client.smtplib, "SMTP", FakeSmtp)
    monkeypatch.setenv("CANONICO_SMTP_HOST", "mail")
    monkeypatch.setenv("CANONICO_SMTP_PORT", "3025")
    result = client.post("/demo/send-email").json()
    assert sent[0][0] == ("mail", 3025) and sent[0][1]["To"] == "brain@inbound.meridianlabs.org"
    assert result["message_id"] == "<demo-0001@meridianlabs.org>" and result["facts_created"] == ["E-301"]
    assert result["supersedes_created"] == [{"fact_id": "E-301", "supersedes": "M-106"}]
    assert client.post("/demo/send-email").status_code == 409


def test_other_modes_do_not_touch_the_mailbox(client, fake):
    assert client.post("/mail/poll").json()["polled"] == 1
    assert fake.logins == []
    assert client.post("/demo/send-email").json()["facts_created"] == ["E-301"]
    assert fake.logins == []

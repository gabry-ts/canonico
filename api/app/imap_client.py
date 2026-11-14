"""Real mailbox access: fetch unseen messages over IMAP, send the demo email over SMTP.

Connection settings come from the environment (CANONICO_IMAP_*, CANONICO_SMTP_*) and are never stored in the memory.
"""

import hashlib
import imaplib
import re
import smtplib
import time
from datetime import datetime, timezone
from email import message_from_bytes, policy
from email.message import EmailMessage
from email.utils import getaddresses, parsedate_to_datetime

from app import files, inbox, settings, store
from app.http import ApiError
from app.store import STORE

TIMEOUT_SECONDS = 15
MAX_MESSAGES = 50
IMAP_ERRORS = (OSError, imaplib.IMAP4.error)


def active(state: dict, project_id: str | None) -> bool:
    """True when the mail configuration in force for the organisation, or the project, is the real mailbox."""
    config = inbox.effective_mail_config(state, state["projects"][project_id]) if project_id else state["org"].get("mail_config")
    return bool(config) and config.get("mode") == "imap"


def imap_settings() -> dict:
    host = settings.env("CANONICO_IMAP_HOST")
    if not host:
        raise ApiError(503, "Mail mode imap needs CANONICO_IMAP_HOST.")
    ssl = settings.env("CANONICO_IMAP_SSL").strip().lower() in ("1", "true", "yes", "on")
    return {
        "host": host,
        "port": int(settings.env("CANONICO_IMAP_PORT") or (993 if ssl else 143)),
        "user": settings.env("CANONICO_IMAP_USER"),
        "password": settings.env("CANONICO_IMAP_PASSWORD"),
        "ssl": ssl,
    }


def smtp_settings() -> dict:
    host = settings.env("CANONICO_SMTP_HOST") or settings.env("CANONICO_IMAP_HOST")
    if not host:
        raise ApiError(503, "Sending the demo email needs CANONICO_SMTP_HOST.")
    return {"host": host, "port": int(settings.env("CANONICO_SMTP_PORT") or 25)}


def connect() -> imaplib.IMAP4:
    cfg = imap_settings()
    try:
        client = (imaplib.IMAP4_SSL if cfg["ssl"] else imaplib.IMAP4)(cfg["host"], cfg["port"], timeout=TIMEOUT_SECONDS)
        client.login(cfg["user"], cfg["password"])
    except IMAP_ERRORS as exc:
        raise ApiError(502, f"The mailbox could not be reached: {exc}") from exc
    return client


def html_to_text(html: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"[ \t]+", " ", re.sub(r"&nbsp;", " ", text)).strip()


def addresses(message: EmailMessage, *headers: str) -> list[str]:
    values = [str(v) for h in headers for v in message.get_all(h, [])]
    return [addr for _, addr in getaddresses(values) if addr]


def iso_date(message: EmailMessage) -> str:
    try:
        parsed = parsedate_to_datetime(str(message["Date"]))
    except (TypeError, ValueError):
        parsed = None
    if parsed is None:
        parsed = datetime.now(timezone.utc)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse(raw: bytes) -> dict:
    """The inbound email shape of the pipeline, from the raw RFC 822 message."""
    message = message_from_bytes(raw, policy=policy.default)
    message_id = str(message["Message-ID"] or "").strip() or f"<sha1-{hashlib.sha1(raw).hexdigest()[:20]}@imap.local>"
    body = message.get_body(preferencelist=("plain", "html"))
    text = ""
    if body is not None:
        text = body.get_content()
        if body.get_content_type() == "text/html":
            text = html_to_text(text)
    attachments = []
    for part in message.iter_attachments():
        filename = part.get_filename() or ""
        try:
            data = part.get_payload(decode=True) or b""
            attachments.append({"filename": filename or "attachment", "text": files.text_of(filename, part.get_content_type(), data).strip()})
        except ApiError:
            continue
    sender = addresses(message, "From")
    return {
        "message_id": message_id,
        "from": sender[0] if sender else "",
        "to": addresses(message, "To"),
        "cc": addresses(message, "Cc"),
        "subject": str(message["Subject"] or "").strip(),
        "date": iso_date(message),
        "text": text.strip(),
        "attachments": attachments,
    }


def fetch_unseen(client: imaplib.IMAP4) -> list[tuple[bytes, dict]]:
    """Unseen messages of the inbox as (uid, email), read without setting the seen flag."""
    client.select("INBOX")
    status, data = client.uid("SEARCH", None, "UNSEEN")
    if status != "OK":
        raise ApiError(502, "The mailbox search failed.")
    found = []
    for uid in (data[0] or b"").split()[:MAX_MESSAGES]:
        status, parts = client.uid("FETCH", uid, "(BODY.PEEK[])")
        raw = next((p[1] for p in parts if isinstance(p, tuple)), None) if status == "OK" else None
        if raw:
            found.append((uid, parse(raw)))
    return found


def mark_seen(client: imaplib.IMAP4, uids: list[bytes]) -> None:
    for uid in uids:
        client.uid("STORE", uid, "+FLAGS", "(\\Seen)")


def poll(project_id: str | None) -> dict:
    """Pull the unseen messages of the mailbox through the same pipeline as POST /mail/inbound.

    Network access happens outside the memory lock. A message that was already received (same Message-ID)
    is only marked seen. Messages that belong to another project than the polled one stay unseen.
    """
    client = connect()
    try:
        fetched = fetch_unseen(client)
        results, done = [], []
        with STORE.write() as state:
            overridden = project_id is not None and bool(state["projects"][project_id].get("mail_config_override"))
            for uid, email in fetched:
                if project_id is not None and not overridden:
                    rule, _ = inbox.route(state, email)
                    if (rule or {}).get("project_id") != project_id:
                        continue
                done.append(uid)
                try:
                    results.append(inbox.receive(state, email))
                except ApiError:
                    continue
        mark_seen(client, done)
    except IMAP_ERRORS as exc:
        raise ApiError(502, f"The mailbox could not be read: {exc}") from exc
    finally:
        try:
            client.logout()
        except IMAP_ERRORS:
            pass
    return {"polled": len(done), "results": results}


def send_demo_email(email: dict) -> None:
    """Deliver the canned email to the demo mailbox over real SMTP."""
    message = EmailMessage()
    message["From"] = email["from"]
    message["To"] = ", ".join(email["to"])
    message["Subject"] = email["subject"]
    message["Message-ID"] = email["message_id"]
    message["Date"] = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    message.set_content(email["text"])
    cfg = smtp_settings()
    try:
        with smtplib.SMTP(cfg["host"], cfg["port"], timeout=TIMEOUT_SECONDS) as smtp:
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        raise ApiError(502, f"The demo email could not be sent: {exc}") from exc


def demo_send(email: dict) -> dict:
    """Send the demo email through SMTP, then poll until the mailbox hands it back. 409 when it was received before."""
    send_demo_email(email)
    for attempt in range(10):
        result = poll(None)
        match = next((r for r in result["results"] if r["message_id"] == email["message_id"]), None)
        if match is not None:
            return match
        with STORE.read() as state:
            if any(m["message_id"] == email["message_id"] for m in state["messages"]):
                raise ApiError(409, f"Message {email['message_id']} was already received.")
        time.sleep(0.3 * (attempt + 1))
    raise ApiError(504, "The demo email did not reach the mailbox in time.")

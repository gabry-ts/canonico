"""Synthetic inputs generated at test time. Names and companies are invented."""

import io
import random

PEOPLE = ["Alessia (ops lead)", "Tomas (intake)", "Priya (quality)", "Jonas (finance)", "Marta (client services)"]

FILLER = [
    "I pulled the numbers from last week and they look roughly in line with what we saw before the holidays.",
    "Before we move on, can everyone confirm they can see the shared board, it was a bit slow to load this morning.",
    "We should keep in mind that the reporting template changed in October, so some columns are not comparable.",
    "I talked to two of the coordinators and they mostly agree with the picture, with a few exceptions on Fridays.",
    "Let's not spend too long on this item, we have a lot to cover and the room is booked until eleven.",
    "My concern is mostly about the handover between the first and the second shift, that is where things slip.",
    "That matches what the client told us in the workshop, although they were not very precise about the volumes.",
    "I will send around the spreadsheet after the call so people can check the formulas themselves.",
    "We tried a similar approach in another account and it worked, but the team there was twice as large.",
    "Can we park the tooling discussion for now and come back to it once we have the budget figures.",
    "There is also the question of who signs off on exceptions, today it depends on who happens to be around.",
    "Fine for me, as long as we document the assumption somewhere people can find it.",
]


def transcript(min_words: int = 2200) -> tuple[str, dict]:
    """A long meeting with several decisions and one decision reversed later in the same meeting.

    Returns the text and the expected final values per subject.
    """
    rng = random.Random(7)
    decisions = [
        ("Alessia", "Decision: the intake response SLA for new service requests is set at 5 business days, effective next month."),
        ("Jonas", "Agreed: the monthly reporting pack is due on the 6th working day of each month."),
        ("Priya", "Decision: every escalated request gets a quality review within 48 hours of escalation."),
        ("Marta", "We agreed that the client steering meeting moves from monthly to every 2 weeks."),
    ]
    reversal = ("Alessia", "Correction to what we decided earlier: the intake response SLA is 3 business days, not 5 business days. We are reversing the earlier decision, 3 business days is final.")
    lines = ["Ops steering meeting, transcript", ""]
    words = 0
    slots = {6: decisions[0], 14: decisions[1], 22: decisions[2], 30: decisions[3], 40: reversal}
    turn = 0
    while words < min_words or turn <= 40:
        if turn in slots:
            speaker, line = slots[turn]
        else:
            speaker, line = rng.choice(PEOPLE).split(" (")[0], " ".join(rng.sample(FILLER, 3))
        lines.append(f"{speaker}: {line}")
        words += len(line.split())
        turn += 1
    expected = {"intake response sla": "3 business days", "reporting pack": "6th working day", "quality review": "48 hours", "steering meeting": "2 weeks"}
    return "\n".join(lines), expected


def docx_bytes(paragraphs: list[str]) -> bytes:
    import docx

    document = docx.Document()
    for paragraph in paragraphs:
        document.add_paragraph(paragraph)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def pdf_bytes(lines: list[str]) -> bytes:
    """A minimal one-page PDF with Helvetica text lines, written by hand."""

    def escape(text: str) -> str:
        return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    content = "BT /F1 11 Tf 50 780 Td 14 TL\n" + "\n".join(f"({escape(line)}) Tj T*" for line in lines) + "\nET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(content.encode('latin-1'))} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def huge_text(chars: int = 300_000) -> str:
    rng = random.Random(11)
    parts, size = [], 0
    while size < chars:
        sentence = " ".join(rng.sample(FILLER, 2)) + f" Batch {len(parts)} recorded {rng.randint(10, 99)} requests in the backlog."
        parts.append(sentence)
        size += len(sentence) + 1
    return "\n".join(parts)

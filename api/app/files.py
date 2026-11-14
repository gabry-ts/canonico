"""Text of uploaded or linked files: plain text, markdown, PDF and DOCX."""

import io
import ipaddress
import os
import socket
from urllib.parse import urljoin, urlparse

import httpx

from app.http import ApiError

MAX_BYTES = 10 * 1024 * 1024
TIMEOUT_SECONDS = 15.0
MAX_REDIRECTS = 3
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
CONTENT_TYPES = {"text/plain": ".txt", "text/markdown": ".md", "text/x-markdown": ".md", "application/pdf": ".pdf", DOCX: ".docx"}
EXTENSIONS = (".txt", ".md", ".markdown", ".pdf", ".docx")


def text_of(filename: str, content_type: str, data: bytes) -> str:
    """Extract the text of a file. 415 for formats that are not read, 422 when a file is broken."""
    name = (filename or "").lower()
    kind = (content_type or "").split(";")[0].strip().lower()
    if name.endswith(".docx") or kind == DOCX:
        try:
            import docx
        except ImportError as exc:
            raise ApiError(415, "DOCX files cannot be read on this server. Send a .txt, .md or .pdf file, or the text in the JSON body.") from exc
        try:
            document = docx.Document(io.BytesIO(data))
        except Exception as exc:
            raise ApiError(422, "file: the DOCX could not be read.") from exc
        lines = [p.text for p in document.paragraphs]
        for table in document.tables:
            lines += [" | ".join(cell.text for cell in row.cells) for row in table.rows]
        return "\n".join(line for line in lines if line.strip())
    if name.endswith(".pdf") or kind == "application/pdf" or data[:5] == b"%PDF-":
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise ApiError(415, "PDF files cannot be read on this server. Send a .txt or .md file, or the text in the JSON body.") from exc
        try:
            return "\n\n".join((page.extract_text() or "") for page in PdfReader(io.BytesIO(data)).pages).strip()
        except Exception as exc:
            raise ApiError(422, "file: the PDF could not be read.") from exc
    if name.endswith((".txt", ".md", ".markdown")) or kind.startswith("text/"):
        return data.decode("utf-8", errors="replace")
    raise ApiError(415, f"Files of type {kind or name or 'unknown'} are not supported. Send .txt, .md, .pdf or .docx.")


def _public_host(host: str) -> bool:
    """True when every address of the host is a public one. Internal addresses are never fetched."""
    if os.environ.get("CANONICO_ALLOW_PRIVATE_FETCH") == "1":
        return True
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(host, None)}
    except OSError:
        return False
    return bool(addresses) and all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addresses)


def _client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False, headers={"User-Agent": "canonico-demo"})


def fetch(url: str) -> tuple[str, str, bytes]:
    """Download a linked file: http or https only, public hosts only, 10 MB at most, 15 seconds, known types."""
    current = str(url)
    with _client() as client:
        for _ in range(MAX_REDIRECTS + 1):
            parsed = urlparse(current)
            if parsed.scheme not in ("http", "https") or not parsed.hostname:
                raise ApiError(422, "file_url: only http and https addresses are fetched.")
            if not _public_host(parsed.hostname):
                raise ApiError(422, "file_url: the host cannot be reached or is not a public address.")
            try:
                with client.stream("GET", current) as response:
                    if response.status_code in (301, 302, 303, 307, 308) and response.headers.get("location"):
                        current = urljoin(current, response.headers["location"])
                        continue
                    if response.status_code != 200:
                        raise ApiError(422, f"file_url: the server answered {response.status_code}.")
                    kind = response.headers.get("content-type", "").split(";")[0].strip().lower()
                    name = parsed.path.rsplit("/", 1)[-1]
                    by_extension = kind in ("", "application/octet-stream", "binary/octet-stream") and name.lower().endswith(EXTENSIONS)
                    if kind not in CONTENT_TYPES and not by_extension:
                        raise ApiError(422, f"file_url: content type {kind or 'unknown'} is not accepted. Link a .txt, .md, .pdf or .docx file.")
                    if int(response.headers.get("content-length") or 0) > MAX_BYTES:
                        raise ApiError(422, "file_url: the file is larger than 10 MB.")
                    data = bytearray()
                    for chunk in response.iter_bytes():
                        data.extend(chunk)
                        if len(data) > MAX_BYTES:
                            raise ApiError(422, "file_url: the file is larger than 10 MB.")
                    return name or ("file" + CONTENT_TYPES.get(kind, "")), kind, bytes(data)
            except httpx.TimeoutException as exc:
                raise ApiError(422, "file_url: the download took longer than 15 seconds.") from exc
            except httpx.HTTPError as exc:
                raise ApiError(422, "file_url: the file could not be downloaded.") from exc
    raise ApiError(422, "file_url: too many redirects.")


def text_from_url(url: str) -> str:
    name, kind, data = fetch(url)
    try:
        return text_of(name, kind, data)
    except ApiError as exc:
        if exc.status == 415:
            raise ApiError(422, "file_url: " + exc.message) from exc
        raise


def with_linked_text(item: dict) -> dict:
    """Fill the text of an item from its `file_url` when no text was sent."""
    if not (item.get("text") or "").strip() and item.get("file_url"):
        return {**item, "text": text_from_url(item["file_url"])}
    return item

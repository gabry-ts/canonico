"""Text the backend generates, in English (default) and Italian.

The locale of a request comes from the `locale` query parameter or body field, else from the
`Accept-Language` header, else English. Values and quotes of facts are never translated: they stay
in the language of their source. Only the sentences built around them change.
"""

import contextvars
import re
from contextlib import contextmanager

SUPPORTED = ("en", "it")
DEFAULT = "en"
_current: contextvars.ContextVar[str] = contextvars.ContextVar("canonico_locale", default=DEFAULT)


def current() -> str:
    return _current.get()


def normalise(value: str | None) -> str | None:
    code = (value or "").strip().lower().replace("_", "-").split("-")[0]
    return code if code in SUPPORTED else None


def from_header(value: str | None) -> str | None:
    """First supported language of an Accept-Language header, by quality."""
    choices = []
    for position, part in enumerate((value or "").split(",")):
        name, _, quality = part.strip().partition(";q=")
        try:
            weight = float(quality) if quality else 1.0
        except ValueError:
            weight = 0.0
        code = normalise(name)
        if code:
            choices.append((-weight, position, code))
    return min(choices)[2] if choices else None


def choose(explicit: str | None, header: str | None) -> str:
    return normalise(explicit) or from_header(header) or DEFAULT


@contextmanager
def using(locale: str | None):
    token = _current.set(normalise(locale) or current())
    try:
        yield
    finally:
        _current.reset(token)


class LocaleMiddleware:
    """Sets the locale of each request from `?locale=` or the Accept-Language header."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        query = scope.get("query_string", b"").decode("latin-1")
        explicit = next((pair.split("=", 1)[1] for pair in query.split("&") if pair.startswith("locale=")), None)
        header = next((value.decode("latin-1") for name, value in scope.get("headers", []) if name == b"accept-language"), None)
        token = _current.set(choose(explicit, header))
        try:
            await self.app(scope, receive, send)
        finally:
            _current.reset(token)


# ---------------------------------------------------------------- sentences

MESSAGES: dict[str, tuple[str, str]] = {
    "answer.figure": ("{lead}. That is {what} set in {source} on {date}.", "{lead}. È {what}, fissato {source_in} il {date}."),
    "answer.subject": ("{subject} is {short}, set in {source}.", "{subject} è {short}, fissato {source_in}."),
    "answer.generic": ("{value}, according to {source} ({date}).", "{value}, secondo {source} ({date})."),
    "answer.replaced_one": (" It replaced 1 earlier version.", " Ha sostituito 1 versione precedente."),
    "answer.replaced_many": (" It replaced {n} earlier versions.", " Ha sostituito {n} versioni precedenti."),
    "answer.pinned": (" A person marked it as binding.", " Una persona lo ha indicato come vincolante."),
    "answer.stale_one": (" One superseded figure is still active: {target}.", " Un valore superato è ancora attivo: {target}."),
    "answer.stale_many": (" {n} superseded figures are still active: {targets}.", " {n} valori superati sono ancora attivi: {targets}."),
    "answer.conflict_one": (" One conflict remains, {label} still says {short}.", " Resta un conflitto: {label} indica ancora {short}."),
    "answer.conflict_many": (" {n} conflicts remain: {parts}.", " Restano {n} conflitti: {parts}."),
    "answer.conflict_part": ("{label} says {short}", "{label} indica {short}"),
    "answer.retired": (" {target} was retired.", " {target} è stato ritirato."),
    "answer.retired_by": (" {target} was retired by {actor}.", " {target} è stato ritirato da {actor}."),
    "answer.dropped": (" {label} ({short}) is no longer binding.", " {label} ({short}) non è più vincolante."),
    "answer.confirms": (" {label} confirms it.", " {label} lo conferma."),
    "answer.contested": (
        "{n} sources give different values ({values}) and nothing in memory says which one is binding.",
        "{n} fonti indicano valori diversi ({values}) e nulla in memoria dice quale sia vincolante.",
    ),
    "answer.evidence": (
        "No decision is recorded on this. The best supported fact: {value}, from {source} ({date}).",
        "Non c'è una decisione registrata su questo. Il fatto meglio supportato: {value}, da {source} ({date}).",
    ),
    "answer.hypothesis": (
        "No decision is recorded on this, only an estimate: {value}, from {source} ({date}).",
        "Non c'è una decisione registrata su questo, solo una stima: {value}, da {source} ({date}).",
    ),
    "answer.open": ("This is still an open question: {value}. Nothing binding is recorded.", "È ancora una domanda aperta: {value}. Non c'è nulla di vincolante registrato."),
    "answer.none": ("Memory holds nothing relevant to this question.", "In memoria non c'è nulla di pertinente a questa domanda."),
    "source.title": ("“{title}”", "“{title}”"),
    "source.manual": ("a manual entry", "un inserimento manuale"),
    "label.fact": ("fact {id}", "il fatto {id}"),
    "label.extracted": ("the fact “{short}” from “{title}”", "il fatto “{short}” da “{title}”"),
    "label.memory": ("the memory", "la memoria"),
    "change.person": ("{actor} {phrases}", "{actor} {phrases}"),
    "change.replaced": ("{cause} replaced {target}", "{cause} ha sostituito {target}"),
    "change.stated": ("{cause} stated {short}", "{cause} ha indicato {short}"),
    "change.fallback": ("memory changed since the previous answer", "la memoria è cambiata dalla risposta precedente"),
    "join.and": (" and ", " e "),
    "verb.retire": ("retired", "ha ritirato"),
    "verb.restore": ("restored", "ha ripristinato"),
    "verb.patch": ("corrected", "ha corretto"),
    "verb.pin": ("marked as binding", "ha indicato come vincolante"),
    "verb.unpin": ("unpinned", "ha tolto l'indicazione di vincolante da"),
    "verb.supersede": ("linked as superseded", "ha collegato come superato"),
    "verb.unlink": ("unlinked", "ha scollegato"),
    "verb.resolve": ("resolved the conflict on", "ha risolto il conflitto su"),
    "verb.create": ("added", "ha aggiunto"),
    "verb.approve": ("retired", "ha ritirato"),
    "verb.undo": ("undid a change to", "ha annullato una modifica a"),
    "verb.delete_document": ("deleted the source of", "ha eliminato la fonte di"),
    "verb.merge": ("merged the topic of", "ha unito il topic di"),
    "verb.classify": ("re-classified", "ha riclassificato"),
    "verb.ingest": ("added", "ha aggiunto"),
    "maintenance.superseded_still_retrievable": (
        "Superseded by {by} ({date}), but still active: plain retrieval returns it until someone retires it.",
        "Superato da {by} ({date}), ma ancora attivo: il retrieval semplice lo restituisce finché qualcuno non lo ritira.",
    ),
    "maintenance.stale": (
        "More than {days} days older than the latest decision on the same topic and not linked to it.",
        "Più vecchio di oltre {days} giorni rispetto all'ultima decisione sullo stesso topic e non collegato ad essa.",
    ),
    "maintenance.low_confidence": ("Confidence {confidence} is below the threshold {threshold}.", "La confidenza {confidence} è sotto la soglia {threshold}."),
    "conflict.auto": ("{parts}, and nothing links them.", "{parts}, e nulla li collega."),
    "conflict.answered": ("Settled by closing the open question “{question}”.", "Risolto chiudendo la domanda aperta “{question}”."),
    "answer.closed_question": (" It answers the open question “{question}”.", " Risponde alla domanda aperta “{question}”."),
    "verb.close": ("answered the open question on", "ha risposto alla domanda aperta su"),
    "audit.reset": ("Demo state restored from the seed.", "Stato della demo ripristinato dal seed."),
    "audit.seed": ("Seeded demo memory from the ClearPath corpus.", "Memoria demo caricata dal corpus ClearPath."),
    "audit.email": ("Email “{subject}” from {sender} routed to {project} by {rule}.", "Email “{subject}” di {sender} instradata a {project} dalla regola {rule}."),
    "audit.email_unrouted": ("Email “{subject}” from {sender} kept at organisation scope, no rule matched.", "Email “{subject}” di {sender} tenuta a livello di organizzazione, nessuna regola corrisponde."),
    "audit.item": ("{type} “{title}” received in {project}.", "{type} “{title}” ricevuto in {project}."),
    "audit.version": ("{label} of “{title}” uploaded to the document library.", "{label} di “{title}” caricata nella libreria documenti."),
}

MONTHS = {
    "en": ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"),
    "it": ("gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"),
}


def t(key: str, **params) -> str:
    english, italian = MESSAGES[key]
    return (italian if current() == "it" else english).format(**params)


def long_date(value: str) -> str:
    year, month, day = value.split("-")
    return f"{int(day)} {MONTHS[current()][int(month) - 1]} {year}"


def short_date(value: str) -> str:
    """"28 Nov 2025" ("28 nov 2025" in Italian), the way the web app shows dates."""
    try:
        year, month, day = value[:10].split("-")
        return f"{int(day)} {MONTHS[current()][int(month) - 1][:3]} {year}"
    except (ValueError, IndexError):
        return value


def join(parts: list[str]) -> str:
    if len(parts) <= 1:
        return "".join(parts)
    return ", ".join(parts[:-1]) + t("join.and") + parts[-1]


_UNITS_IT = (
    ("business days", "giorni lavorativi"),
    ("business day", "giorno lavorativo"),
    ("working days", "giorni lavorativi"),
    ("working day", "giorno lavorativo"),
    ("weeks", "settimane"),
    ("week", "settimana"),
    ("days", "giorni"),
    ("day", "giorno"),
    ("months", "mesi"),
    ("month", "mese"),
    ("hours", "ore"),
    ("hour", "ora"),
    ("years", "anni"),
    ("year", "anno"),
    ("percent", "per cento"),
)


def quantity(text: str) -> str:
    """A short figure such as "3–4 weeks" in the current locale. Anything else is returned as it is."""
    if current() != "it" or not text:
        return text
    out = re.sub(r"^below (.+)$", r"meno di \1", text)
    out = re.sub(r"^(.+) or less$", r"\1 o meno", out)
    out = re.sub(r"^about ", "circa ", out)
    for english, italian in _UNITS_IT:
        out = re.sub(rf"(?<![A-Za-z]){english}(?![A-Za-z])", italian, out)
    return out


# ---------------------------------------------------------------- sources that arrive

_ITEM_IT = {"meeting": ("la riunione", "nella riunione"), "document": ("il documento", "nel documento"), "note": ("la nota", "nella nota"), "ticket": ("il ticket", "nel ticket")}


def source_label(src: dict) -> str | None:
    """Name of a source that brought a fact in: an email, a document version, an item."""
    kind = src.get("kind")
    if kind == "email":
        return f"l'email di {src['sender']}" if current() == "it" else f"the email from {src['sender']}"
    if kind == "version":
        return f"la versione {src['number']} di “{src['title']}”" if current() == "it" else f"version {src['number']} of “{src['title']}”"
    if kind == "item":
        return f"{_ITEM_IT[src['type']][0]} “{src['title']}”" if current() == "it" else f"the {src['type']} “{src['title']}”"
    return None


def source_in(src: dict) -> str | None:
    """Italian "in the source" form, with the right preposition."""
    kind = src.get("kind")
    if kind == "email":
        return f"nell'email di {src['sender']}"
    if kind == "version":
        return f"nella versione {src['number']} di “{src['title']}”"
    if kind == "item":
        return f"{_ITEM_IT[src['type']][1]} “{src['title']}”"
    return None


def source_short(src: dict) -> str | None:
    kind = src.get("kind")
    if kind == "email":
        return f"email di {src['sender']}" if current() == "it" else f"email from {src['sender']}"
    if kind == "version":
        return f"{src['title'].lower()} {src.get('label') or 'v' + str(src['number'])}"
    if kind == "item":
        return src["title"]
    return None


def cause(src: dict | None, fallback: str) -> str:
    """Subject of a change that came from a source: "an email from …", "version 3 of …"."""
    if not src or current() != "it":
        return fallback
    if src.get("kind") == "email":
        return f"un'email di {src['sender']}"
    return source_label(src) or fallback


# ---------------------------------------------------------------- errors

_NOUNS_IT = {
    "Supersedes link of fact": ("Link di sostituzione del fatto", "o"),
    "Maintenance item": ("Voce di manutenzione", "a"),
    "Evaluation result": ("Risultato della valutazione", "o"),
    "Evaluation run": ("Esecuzione della valutazione", "a"),
    "Open question": ("Domanda aperta", "a"),
    "Audit event": ("Evento di audit", "o"),
    "Sync job": ("Job di sincronizzazione", "o"),
    "Mail rule": ("Regola mail", "a"),
    "Tag rule": ("Regola tag", "a"),
    "Repository": ("Repository", "o"),
    "Document": ("Documento", "o"),
    "Conflict": ("Conflitto", "o"),
    "Project": ("Progetto", "o"),
    "Member": ("Membro", "o"),
    "Source": ("Fonte", "a"),
    "Answer": ("Risposta", "a"),
    "Topic": ("Topic", "o"),
    "Fact": ("Fatto", "o"),
    "Item": ("Elemento", "o"),
    "Job": ("Job", "o"),
}
_ERRORS_IT: tuple[tuple[str, str], ...] = (
    (r"^Role (\S+) lacks permission (\S+)\.$", r"Il ruolo \1 non ha il permesso \2."),
    (r"^Invalid X-Canonico-Token\.$", "X-Canonico-Token non valido."),
    (r"^Wrong email or password\.$", "Email o password errate."),
    (r"^Sign in to continue\.$", "Accedi per continuare."),
    (r"^Repository (\S+) was not found or is not public\.$", r"Il repository \1 non esiste o non è pubblico."),
    (r"^Repository (\S+) could not be looked up: (.+)\.$", r"Impossibile consultare il repository \1: \2."),
    (r"^(\S+): enter an email address like brain@inbound\.example\.com\.$", r"\1: inserisci un indirizzo email come brain@inbound.example.com."),
    (r"^value: enter a sender domain like @client\.com\.$", "value: inserisci un dominio mittente come @client.com."),
    (r"^value: enter an email address like name@client\.com\.$", "value: inserisci un indirizzo email come nome@client.com."),
    (r"^mode: this server has no real mailbox \(CANONICO_IMAP_HOST is not set\)\. Use imap_mock or webhook\.$", "mode: questo server non ha una casella reale (CANONICO_IMAP_HOST non è impostato). Usa imap_mock o webhook."),
    (r"^Rule (\S+) already matches (\S+) (.+)\.$", r"La regola \1 corrisponde già a \2 \3."),
    (r"^text: the content is not readable text \(is it an image or another binary file\?\)\. Send a \.txt, \.md, \.pdf or \.docx file\.$", "text: il contenuto non è testo leggibile (è un'immagine o un altro file binario?). Invia un file .txt, .md, .pdf o .docx."),
    (r"^file: the file is not a text file\. Send \.txt, \.md, \.pdf or \.docx\.$", "file: il file non è un file di testo. Invia un file .txt, .md, .pdf o .docx."),
    (r"^No project_id and no tag rule matched the item\.$", "Nessun project_id e nessuna regola di tag corrisponde all'elemento."),
    (r"^Malformed JSON body\.$", "Corpo JSON non valido."),
    (r"^Unexpected server error\.$", "Errore imprevisto del server."),
    (r"^Validation failed\.$", "Validazione non riuscita."),
    (r"^Conflict (\S+) is already resolved\.$", r"Il conflitto \1 è già risolto."),
    (r"^Offline mode is on, no model calls are made\.$", "La modalità offline è attiva, nessuna chiamata al modello."),
    (r"^No model provider is configured on the server\.$", "Nessun provider di modelli è configurato sul server."),
    (r"^The cost cap has been reached\.$", "Il tetto di costo è stato raggiunto."),
    (r"^Fact (\S+) is retired and cannot be pinned\.$", r"Il fatto \1 è ritirato e non può essere fissato."),
    (r"^Message (\S+) was already received\.$", r"Il messaggio \1 è già stato ricevuto."),
    (r"^The last owner cannot be removed\.$", "L'ultimo owner non può essere rimosso."),
    (r"^The last owner cannot change role\.$", "L'ultimo owner non può cambiare ruolo."),
    (r"^The organisation is already set up\.$", "L'organizzazione è già configurata."),
    (r"^Open question (\S+) is already closed\.$", r"La domanda aperta \1 è già chiusa."),
    (r"^Event (\S+) was already undone\.$", r"L'evento \1 è già stato annullato."),
    (r"^Event (\S+) \((\S+)\) cannot be undone\.$", r"L'evento \1 (\2) non può essere annullato."),
    (r"^Event (\S+) changed the same fact later, undo that one first\.$", r"L'evento \1 ha modificato lo stesso fatto più tardi, annulla prima quello."),
    (r"^This link would create a cycle\.$", "Questo collegamento creerebbe un ciclo."),
    (r"^Both facts must share the same topic\.$", "I due fatti devono appartenere allo stesso topic."),
    (r"^A fact cannot supersede itself\.$", "Un fatto non può sostituire se stesso."),
    (r"^Topic (\S+) already exists\.$", r"Il topic \1 esiste già."),
    (r"^Project (\S+) already exists\.$", r"Il progetto \1 esiste già."),
    (r"^Document (\S+) already exists\.$", r"Il documento \1 esiste già."),
    (r"^This text is identical to the current version\.$", "Questo testo è identico alla versione corrente."),
    (r"^Source (\S+) is not a webhook source\.$", r"La fonte \1 non è una fonte webhook."),
    (r"^Source (\S+) is already syncing\.$", r"La fonte \1 è già in sincronizzazione."),
    (r"^Provide at least one of value, type or topic\.$", "Indica almeno uno tra value, type e topic."),
)


def error_message(message: str) -> str:
    """Italian form of an error message when the locale asks for it. Unknown messages stay in English."""
    if current() != "it":
        return message
    for noun, (italian, ending) in _NOUNS_IT.items():
        match = re.match(rf"^{re.escape(noun)} (.+) not found\.$", message)
        if match:
            return f"{italian} {match.group(1)} non trovat{ending}."
        if message == f"{noun} not found.":
            return f"{italian} non trovat{ending}."
    for pattern, replacement in _ERRORS_IT:
        if re.match(pattern, message):
            return re.sub(pattern, replacement, message)
    return message.replace("Field required", "campo obbligatorio").replace("field required", "campo obbligatorio")

"""How a fact is named inside a generated sentence, in the locale of the request."""

import re

from app import i18n

_EXTRACTED = re.compile(r"^the fact “(.*)” from “(.*)”$")


def extra(fact: dict) -> dict:
    return fact.get("x", {})


def italian(fact: dict) -> dict:
    return extra(fact).get("it") or {}


def label(fact: dict) -> str:
    """Noun phrase for a fact: "requirement R1.1", "the email from …"."""
    x = extra(fact)
    if i18n.current() == "it":
        if italian(fact).get("label"):
            return italian(fact)["label"]
        if x.get("src"):
            return i18n.source_label(x["src"]) or x.get("label") or i18n.t("label.fact", id=fact["id"])
        match = _EXTRACTED.match(x.get("label") or "")
        if match:
            return i18n.t("label.extracted", short=i18n.quantity(match.group(1)), title=match.group(2))
        if not x.get("label"):
            return i18n.t("label.fact", id=fact["id"])
    return x.get("label") or f"fact {fact['id']}"


def short(fact: dict) -> str:
    """The bare value of a fact, with units in the locale of the request."""
    if i18n.current() == "it" and italian(fact).get("short"):
        return italian(fact)["short"]
    return i18n.quantity(extra(fact).get("short") or fact["value"].rstrip("."))


def source(state: dict, fact: dict) -> str:
    """Where a fact comes from: "the final report", or the quoted title of its document."""
    x = extra(fact)
    if i18n.current() == "it":
        if italian(fact).get("source_label"):
            return italian(fact)["source_label"]
        if x.get("src"):
            return i18n.source_label(x["src"]) or x.get("source_label", "")
    elif x.get("source_label"):
        return x["source_label"]
    document = state["documents"].get(fact.get("doc_id") or "")
    if document:
        return i18n.t("source.title", title=document["title"])
    return x.get("source_label") or i18n.t("source.manual")


def source_in(state: dict, fact: dict) -> str:
    """Italian "in the source" form, used after "fissato"."""
    if italian(fact).get("source_in"):
        return italian(fact)["source_in"]
    if extra(fact).get("src"):
        return i18n.source_in(extra(fact)["src"]) or "in " + source(state, fact)
    return "in " + source(state, fact)


def source_short(fact: dict) -> str | None:
    x = extra(fact)
    if i18n.current() == "it":
        if italian(fact).get("source_short"):
            return italian(fact)["source_short"]
        if x.get("src"):
            return i18n.source_short(x["src"]) or x.get("source_short")
    return x.get("source_short")


def target(fact: dict) -> str:
    """Short way to name a fact: its value and where it comes from, for example "4 weeks (final presentation)"."""
    origin = source_short(fact)
    if extra(fact).get("short") and origin:
        return f"{short(fact)} ({origin})"
    return label(fact)


def cap(text: str) -> str:
    return text[:1].upper() + text[1:]

"""Deterministic extraction of restated values, used when a new email or document version arrives.

It finds sentences that state a quantity ("5 weeks", "3–4 days") on a topic the memory already
knows. It needs no model call, so the canned demo flows work offline and never fail live.
"""

import re

from app import engine, store
from app.text import tokenize

UNITS = r"business days?|working days?|weeks?|days?|months?|hours?|years?|percent|euros?|eur|%|€"
QUANTITY = re.compile(rf"(\d+(?:[.,]\d+)?)(?:\s*(?:[–—-]|to)\s*(\d+(?:[.,]\d+)?))?\s*({UNITS})(?![a-z])", re.IGNORECASE)
DECISION_WORDS = re.compile(r"\b(confirm\w*|agree\w*|decid\w*|approv\w*|final\w*|commit\w*|sla|target\w*|standard|must|shall)\b", re.IGNORECASE)
_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")
# A sentence that only looks back at a value ("4 weeks was the old plan") states no new value.
RETROSPECTIVE = re.compile(r"\b(old|previous(?:ly)?|former(?:ly)?|outdated|obsolete|no longer|used to|any ?more|abandoned|dropped|scrapped)\b", re.IGNORECASE)
CHANGE_WORDS = re.compile(r"\b(now|chang\w*|revis\w*|mov(?:e|ed|es|ing)|updat\w*|instead|going forward|from now on)\b", re.IGNORECASE)
_UNIT_FAMILY = {"business day": "day", "working day": "day", "eur": "euro", "€": "euro", "%": "percent"}


def unit_of(text: str) -> str | None:
    match = QUANTITY.search(text or "")
    if not match:
        return None
    unit = match.group(3).lower().rstrip("s")
    return _UNIT_FAMILY.get(unit, unit)


def short_of(text: str) -> str | None:
    """Normalised quantity of a sentence, for example "3–4 weeks"."""
    match = QUANTITY.search(text or "")
    if not match:
        return None
    low, high, unit = match.group(1), match.group(2), match.group(3)
    amount = f"{low}–{high}" if high else low
    return f"{amount} {unit.lower()}" if unit not in ("%", "€") else f"{amount}{unit}"


def amount_of(text: str) -> str | None:
    match = QUANTITY.search(text or "")
    return f"{match.group(1)}-{match.group(2) or ''}" if match else None


def _anchors(topic: dict) -> set[str]:
    extra = topic.get("x", {})
    return set(tokenize(" ".join([topic["label"], *extra.get("keywords", [])])))


def sentences(text: str) -> list[str]:
    parts = [re.sub(r"^[\s#>*\-\d.)]+", "", part).strip() for part in _SENTENCE.split(text)]
    return [part for part in parts if len(part) >= 8]


def find(state: dict, text: str, project_id: str | None, prefer_topics: set[str] | None = None, force_topic: str | None = None) -> list[dict]:
    """Statements of a quantity on a known topic, one per topic, in order of appearance.

    A sentence is assigned to the best matching topic that shares at least two anchor words
    (label and keywords) with it. Topics in `prefer_topics` are tried first. With `force_topic`
    the first sentence that states a quantity is filed under that topic.
    """
    found: dict[str, dict] = {}
    for sentence in sentences(text):
        short = short_of(sentence)
        if short is None or (RETROSPECTIVE.search(sentence) and not CHANGE_WORDS.search(sentence)):
            continue
        if force_topic is not None:
            if force_topic not in found:
                topic = state["topics"][force_topic]
                found[force_topic] = {
                    "topic": force_topic,
                    "value": f"{topic['label']}: {short}",
                    "short": short,
                    "type": "DECISION" if DECISION_WORDS.search(sentence) else "EVIDENCE",
                    "quote": sentence,
                    "confidence": 0.9,
                }
            continue
        words = set(tokenize(sentence))
        ranked = [t for t, _, _ in engine.rank_topics(state, sentence, project_id)]
        if prefer_topics:
            ranked = [t for t in ranked if t in prefer_topics] + [t for t in ranked if t not in prefer_topics]
        shared = {t: words & _anchors(state["topics"][t]) for t in ranked}
        fitting = [t for t in ranked if len(shared[t]) >= 2 or (prefer_topics and t in prefer_topics and shared[t])]
        if not fitting:
            continue
        topic_id = fitting[0]
        if not (prefer_topics and topic_id in prefer_topics):
            # Among the best ranked candidates, the topic that shares most anchor words wins:
            # "the steering committee confirmed the onboarding target" is about onboarding, not the committee.
            topic_id = max(fitting[:5], key=lambda t: len(shared[t]))
        if topic_id not in found:
            topic = state["topics"][topic_id]
            found[topic_id] = {
                "topic": topic_id,
                "value": f"{topic['label']}: {short}",
                "short": short,
                "type": "DECISION" if DECISION_WORDS.search(sentence) else "EVIDENCE",
                "quote": sentence,
                "confidence": 0.9,
            }
    return list(found.values())


def restates(old: dict, new_short: str) -> bool:
    """True when an existing fact states the same kind of quantity, so the new value can replace it."""
    old_text = old.get("x", {}).get("short") or old["value"]
    return unit_of(old_text) is not None and unit_of(old_text) == unit_of(new_short)


def same_value(old: dict, new_short: str) -> bool:
    old_text = old.get("x", {}).get("short") or old["value"]
    return amount_of(old_text) == amount_of(new_short) and unit_of(old_text) == unit_of(new_short)


def live(state: dict, fact: dict) -> bool:
    return fact["status"] == "active" and not store.is_superseded(state, fact)

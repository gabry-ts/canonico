import math
import re
from collections import Counter

STOPWORDS = set(
    """a an and are as at be been but by did do does for from had has have how i if in into is it its
    of on or over s so than that the their them then there these they this to was were what when where
    which who whom why will with would you your about also any can could ever given just more most much
    not only other our out per should some such up us we were whether while during after before
    actually really ultimately ever slightly state states stated""".split()
)

_WORD = re.compile(r"[a-z0-9]+(?:[.\-–][0-9]+)*")


def stem(word: str) -> str:
    for suffix in ("ations", "ation", "ings", "ing", "ies", "ed", "es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            if suffix == "ies":
                return word[: -len(suffix)] + "y"
            return word[: -len(suffix)]
    return word


def tokenize(text: str) -> list[str]:
    words = _WORD.findall(text.lower().replace("’", "'"))
    return [stem(w) for w in words if w not in STOPWORDS and len(w) > 1]


class BM25:
    """Okapi BM25 over a small in-memory collection."""

    def __init__(self, docs: dict[str, list[str]], k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.ids = list(docs)
        self.tf = {i: Counter(tokens) for i, tokens in docs.items()}
        self.len = {i: len(tokens) for i, tokens in docs.items()}
        self.avg = (sum(self.len.values()) / len(self.len)) if self.len else 0.0
        df: Counter = Counter()
        for counts in self.tf.values():
            df.update(counts.keys())
        n = len(self.ids)
        self.idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}

    def score(self, query: list[str], doc_id: str) -> float:
        tf = self.tf[doc_id]
        norm = 1 - self.b + self.b * (self.len[doc_id] / self.avg if self.avg else 0)
        total = 0.0
        for term in set(query):
            f = tf.get(term, 0)
            if f:
                total += self.idf[term] * f * (self.k1 + 1) / (f + self.k1 * norm)
        return total

    def rank(self, query: list[str]) -> list[tuple[str, float]]:
        scored = [(i, self.score(query, i)) for i in self.ids]
        scored = [s for s in scored if s[1] > 0]
        scored.sort(key=lambda s: (-s[1], s[0]))
        return scored


_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")


def best_passage(text: str, query: list[str], limit: int = 240) -> str:
    """Pick the line or sentence of a document that overlaps most with the query."""
    terms = set(query)
    best, best_score = "", 0.0
    for part in _SPLIT.split(text):
        part = part.strip().strip("|").strip()
        if len(part) < 12:
            continue
        tokens = tokenize(part)
        if not tokens:
            continue
        hits = sum(1 for t in set(tokens) if t in terms)
        score = hits / math.sqrt(len(tokens) + 4)
        if score > best_score:
            best, best_score = part, score
    if not best:
        best = text.strip().split("\n", 1)[0]
    best = re.sub(r"^[#>*\-\s]+", "", best).replace("**", "")
    return best[:limit].strip()

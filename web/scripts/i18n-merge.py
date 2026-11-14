#!/usr/bin/env python3
"""Merge one namespace into src/i18n/en.json and it.json, safely under a file lock.

Usage: python3 scripts/i18n-merge.py <namespace> <en-part.json> <it-part.json>
Each part file holds the object stored under the top-level key <namespace>.
Both parts must have exactly the same keys.
"""
import fcntl, json, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent / "src" / "i18n"

def keys(o, p=""):
    out = set()
    for k, v in o.items():
        out |= keys(v, p + k + ".") if isinstance(v, dict) else {p + k}
    return out

def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    ns, en_part, it_part = sys.argv[1], json.loads(Path(sys.argv[2]).read_text("utf-8")), json.loads(Path(sys.argv[3]).read_text("utf-8"))
    diff = keys(en_part) ^ keys(it_part)
    if diff:
        sys.exit("keys differ between en and it: " + ", ".join(sorted(diff)))
    with open(root / ".lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for name, part in (("en.json", en_part), ("it.json", it_part)):
            path = root / name
            data = json.loads(path.read_text("utf-8"))
            data[ns] = part
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"merged namespace '{ns}': {len(keys(en_part))} keys")

main()

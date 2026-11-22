#!/usr/bin/env python3
"""Fill {{PLACEHOLDER}} values across the trial site from a JSON file.

Keep the JSON file OUTSIDE the repo (for example in stage2/pilot-private/), even though
the filled values themselves end up on the public site.

    python3 tools/fill.py ../pilot-private/site-values.json            # replace in place
    python3 tools/fill.py ../pilot-private/site-values.json --dry-run  # only report

The JSON maps placeholder names to text, e.g. {"PAY_WRITER": "2,000"}.
README.md, tools/fill.py and tools/check.py are never changed (they document the names).
After filling, run:  python3 tools/build.py && python3 tools/check.py --prepublish
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
SKIP = {"README.md", "tools/fill.py", "tools/check.py"}
SUFFIXES = {".html", ".md", ".js", ".css", ".py"}
NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")
PLACEHOLDER_RE = re.compile(r"\{\{([A-Z][A-Z0-9_]*)\}\}")
# Values are pasted into HTML, Markdown, a JavaScript string and Python string literals
# (tools/build.py), so characters that would break any of them are refused.
UNSAFE_CHARS = set('{}"\\<>&`\n\r\t')
NUMERIC = {"A_H2_START_S", "B_H2_START_S"}
NUMBER_RE = re.compile(r"^\d+(\.\d+)?$")


def site_files():
    for p in sorted(SITE.rglob("*")):
        rel = p.relative_to(SITE).as_posix()
        if p.is_file() and p.suffix in SUFFIXES and rel not in SKIP and not rel.startswith("media/"):
            yield p, rel


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    values = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    dry = "--dry-run" in argv
    for k, v in values.items():
        if not NAME_RE.match(k):
            print(f"bad placeholder name: {k!r}")
            return 2
        bad = sorted(set(str(v)) & UNSAFE_CHARS)
        if bad:
            print(f"value for {k} must not contain any of {' '.join(repr(c) for c in bad)} "
                  "(they would break the HTML, JavaScript or Python it is pasted into)")
            return 2
        if k in NUMERIC and not NUMBER_RE.match(str(v)):
            print(f"value for {k} must be a number of seconds such as 41.2")
            return 2
    total = 0
    for path, rel in site_files():
        text = path.read_text(encoding="utf-8")
        new = text
        for k, v in values.items():
            new = new.replace("{{" + k + "}}", str(v))
        n = sum(text.count("{{" + k + "}}") for k in values)
        if n:
            total += n
            print(f"{rel}: {n} replacement(s)")
            if not dry:
                path.write_text(new, encoding="utf-8")
    remaining = {}
    for path, rel in site_files():
        text = path.read_text(encoding="utf-8")
        for m in PLACEHOLDER_RE.finditer(text):
            if dry and m.group(1) in values:
                continue
            remaining.setdefault(m.group(1), set()).add(rel)
    print(f"{'would replace' if dry else 'replaced'} {total} occurrence(s)")
    if remaining:
        print("still unfilled:")
        for k in sorted(remaining):
            print(f"  {{{{{k}}}}} in {', '.join(sorted(remaining[k]))}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

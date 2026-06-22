#!/usr/bin/env python3
"""Flag common frontend quality risks. Findings are review leads, not verdicts."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

TEXT_EXTENSIONS = {
    ".css",
    ".html",
    ".js",
    ".jsx",
    ".mjs",
    ".scss",
    ".ts",
    ".tsx",
    ".vue",
    ".svelte",
}

RULES = [
    ("gradient text", re.compile(r"background-clip\s*:\s*text|bg-clip-text", re.I)),
    ("viewport height uses 100vh/h-screen", re.compile(r"\b100vh\b|\bh-screen\b")),
    ("arbitrary high z-index", re.compile(r"z-index\s*:\s*(?:999|[1-9]\d{3,})|z-\[(?:999|[1-9]\d{3,})\]")),
    ("focus outline removed", re.compile(r"outline\s*:\s*none|outline-none")),
    ("layout property transition/animation", re.compile(r"(?:transition|animation)[^;\n]*(?:width|height|top|left|margin|padding)", re.I)),
    ("placeholder-as-label risk", re.compile(r"<input\b(?=[^>]*placeholder=)(?![^>]*(?:aria-label|aria-labelledby|id=))", re.I)),
    ("dead hash link", re.compile(r"""(?:href|to)=["']#["']""")),
    ("generic lorem ipsum", re.compile(r"\blorem ipsum\b", re.I)),
    ("generic AI copy", re.compile(r"\b(?:elevate|unleash|next-gen|game[- ]changer|seamless experience)\b", re.I)),
    ("empty image alt", re.compile(r"<img\b[^>]*\balt=[\"']\s*[\"']", re.I)),
    ("meaningless image alt", re.compile(r"<img\b[^>]*\balt=[\"'](?:image|photo|picture)[\"']", re.I)),
    ("layout animation state risk", re.compile(r"useState\s*\([^)]*\).{0,180}(?:mouse|pointer|scroll)", re.I | re.S)),
]


def iter_files(paths: list[Path]):
    seen: set[Path] = set()
    for path in paths:
        if path.is_file():
            candidates = [path]
        elif path.is_dir():
            candidates = path.rglob("*")
        else:
            continue
        for candidate in candidates:
            if (
                candidate.is_file()
                and candidate.suffix.lower() in TEXT_EXTENSIONS
                and candidate not in seen
                and "node_modules" not in candidate.parts
                and ".next" not in candidate.parts
                and "dist" not in candidate.parts
            ):
                seen.add(candidate)
                yield candidate


def scan(path: Path) -> list[tuple[int, str, str]]:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []

    findings: list[tuple[int, str, str]] = []
    for label, pattern in RULES:
        for match in pattern.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            excerpt = " ".join(match.group(0).split())[:120]
            findings.append((line, label, excerpt))
    return sorted(findings)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    args = parser.parse_args()

    total = 0
    for path in iter_files(args.paths):
        findings = scan(path)
        for line, label, excerpt in findings:
            print(f"{path}:{line}: {label}: {excerpt}")
            total += 1

    print(f"ui-preflight: {total} review lead(s)")
    return 1 if total else 0


if __name__ == "__main__":
    raise SystemExit(main())

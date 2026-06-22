"""Contract tests for the supplied hospitality domain artifacts."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
SOURCE_DIR = ROOT / "hospitality"
RUNTIME_SCHEMA = ROOT / "src" / "main" / "json" / "hospitality.json"


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_runtime_schema_normalizes_supplied_schema_without_semantic_drift() -> None:
    source = _load(SOURCE_DIR / "schema hospitality.json")
    runtime = _load(RUNTIME_SCHEMA)

    assert len(runtime["vertices"]) == 21
    assert len(runtime["edges"]) == 27
    assert [entry["@key"] for entry in runtime["vertices"]] == [
        entry["@key"] for entry in source["vertices"]
    ]

    source_edges = {
        entry["@key"]: (
            entry["@value"].get("outV", entry["@value"].get("out")),
            entry["@value"].get("inV", entry["@value"].get("in")),
        )
        for entry in source["edges"]
    }
    runtime_edges = {
        entry["@key"]: (entry["@value"]["out"], entry["@value"]["in"])
        for entry in runtime["edges"]
    }
    assert runtime_edges == source_edges


def test_section_and_validation_contracts_are_complete() -> None:
    section_map = _load(SOURCE_DIR / "section map.json")
    validation = _load(SOURCE_DIR / "validation rules.json")

    sections = section_map["sections"]
    assert [section["section_id"] for section in sections] == list("ABCDEFG")
    assert [section["order"] for section in sections] == list(range(1, 8))
    assert {rule["rule_id"] for rule in validation["rules"]} == {
        f"HR{number:03d}" for number in range(1, 26)
    }


def test_canonical_schema_edges_reference_declared_vertices() -> None:
    schema = _load(RUNTIME_SCHEMA)
    labels = {entry["@key"] for entry in schema["vertices"]}

    for entry in schema["edges"]:
        value = entry["@value"]
        assert value["out"] in labels
        assert value["in"] in labels
        assert "outV" not in value
        assert "inV" not in value

"""Normalize and validate the supplied hospitality schema for Hydra runtime."""

from __future__ import annotations

import json
from pathlib import Path

from chatgraph.domains.hospitality import DOMAIN


_SOURCE_PATH = (
    Path(__file__).resolve().parents[6]
    / "hospitality"
    / "schema hospitality.json"
)


def _normalized_schema(source: dict) -> dict:
    vertices = source.get("vertices")
    edges = source.get("edges")
    if not isinstance(vertices, list):
        raise ValueError("hospitality schema has no vertices list")
    if not isinstance(edges, list):
        raise ValueError("hospitality schema has no edges list")

    normalized_edges = []
    for entry in edges:
        value = dict(entry["@value"])
        out_label = value.pop("outV", value.get("out"))
        in_label = value.pop("inV", value.get("in"))
        if not out_label or not in_label:
            raise ValueError(f"edge {entry.get('@key')} has no endpoints")
        value["id"] = value.get("id", {"string": {}})
        value["out"] = out_label
        value["in"] = in_label
        value["properties"] = value.get("properties", [])
        normalized_edges.append({"@key": entry["@key"], "@value": value})

    return {"vertices": vertices, "edges": normalized_edges}


def main() -> int:
    with _SOURCE_PATH.open(encoding="utf-8") as handle:
        source = json.load(handle)
    normalized = _normalized_schema(source)
    DOMAIN.schema_path.parent.mkdir(parents=True, exist_ok=True)
    DOMAIN.schema_path.write_text(
        json.dumps(normalized, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"built {DOMAIN.schema_path} "
        f"({len(normalized['vertices'])} vertices, {len(normalized['edges'])} edges)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

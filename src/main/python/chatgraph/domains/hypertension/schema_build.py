"""Validate the supplied hypertension schema artifact.

Unlike the authored medical schema, this domain arrived as a complete Hydra
GraphSchema JSON specification under ``hypertension/``. It is the canonical
artifact; this command verifies that it remains valid JSON.
"""

import json

from chatgraph.domains.hypertension import DOMAIN


def main() -> int:
    with DOMAIN.schema_path.open(encoding="utf-8") as handle:
        schema = json.load(handle)
    if not isinstance(schema.get("vertices"), list):
        raise ValueError("hypertension schema has no vertices list")
    if not isinstance(schema.get("edges"), list):
        raise ValueError("hypertension schema has no edges list")
    print(f"validated {DOMAIN.schema_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

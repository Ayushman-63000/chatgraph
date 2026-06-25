"""Cross-file contracts for hypertension and hospitality expert domains."""

from __future__ import annotations

import json
import importlib.util
from html import unescape
from pathlib import Path
import re
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[4]


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _edge_endpoints(schema: dict) -> dict[str, tuple[str, str]]:
    return {
        entry["@key"]: (
            entry["@value"].get("out", entry["@value"].get("outV")),
            entry["@value"].get("in", entry["@value"].get("inV")),
        )
        for entry in schema["edges"]
    }


def _docx_text(path: Path) -> str:
    with ZipFile(path) as archive:
        xml = archive.read("word/document.xml").decode("utf-8")
    return unescape(re.sub(r"<[^>]+>", " ", xml))


def _normalized_text(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", text.lower())).strip()


def test_hypertension_every_knowledge_vertex_has_typed_provenance_edge() -> None:
    base = ROOT / "hypertension"
    schema = _load(base / "hypertension schema.json")
    provenance = _load(base / "provenance spec.json")
    endpoints = _edge_endpoints(schema)

    for vertex_label, edge_label in provenance["attachment_rules"][
        "edge_label_by_vertex"
    ].items():
        assert endpoints[edge_label] == (vertex_label, "ProvenanceEvidence")


def test_section_maps_only_reference_schema_edges_with_correct_endpoints() -> None:
    for directory, schema_name in (
        ("hospitality", "schema hospitality.json"),
        ("hypertension", "hypertension schema.json"),
    ):
        base = ROOT / directory
        schema = _load(base / schema_name)
        endpoints = _edge_endpoints(schema)
        section_map = _load(base / "section map.json")
        for section in section_map["sections"]:
            for pattern in section["edge_patterns"]:
                assert endpoints[pattern["edge"]] == (
                    pattern["out"],
                    pattern["in"],
                )


def test_validation_edge_catalogs_match_schemas() -> None:
    hospitality_base = ROOT / "hospitality"
    hospitality_schema = _load(hospitality_base / "schema hospitality.json")
    hospitality_rules = _load(hospitality_base / "validation rules.json")["rules"]
    hospitality_endpoints = _edge_endpoints(hospitality_schema)
    allowed = next(
        rule["allowed_edge_labels"]
        for rule in hospitality_rules
        if rule["rule_id"] == "HR003"
    )
    endpoint_map = next(
        rule["edge_endpoint_map"]
        for rule in hospitality_rules
        if rule["rule_id"] == "HR004"
    )
    assert set(allowed) == set(hospitality_endpoints)
    for edge, (out_label, in_label) in hospitality_endpoints.items():
        assert endpoint_map[edge] == {"out": out_label, "in": in_label}

    hypertension_base = ROOT / "hypertension"
    hypertension_schema = _load(hypertension_base / "hypertension schema.json")
    hypertension_rules = _load(hypertension_base / "validation rules.json")["rules"]
    hypertension_endpoints = _edge_endpoints(hypertension_schema)
    allowed = next(
        rule["allowed_edge_labels"]
        for rule in hypertension_rules
        if rule["rule_id"] == "R003"
    )
    endpoint_rules = next(
        rule["endpoint_rules"]
        for rule in hypertension_rules
        if rule["rule_id"] == "R006"
    )
    endpoint_map = {
        rule["edge"]: (rule["out"], rule["in"])
        for rule in endpoint_rules
    }
    assert set(allowed) == set(hypertension_endpoints)
    assert endpoint_map == hypertension_endpoints


def test_hypertension_required_provenance_fields_match_validation() -> None:
    base = ROOT / "hypertension"
    schema = _load(base / "hypertension schema.json")
    validation = _load(base / "validation rules.json")
    provenance = next(
        entry for entry in schema["vertices"]
        if entry["@key"] == "ProvenanceEvidence"
    )
    required = {
        prop["key"]
        for prop in provenance["@value"]["properties"]
        if prop.get("required")
    }
    rule = next(
        item for item in validation["rules"]
        if item["rule_id"] == "R004"
    )
    assert required == {"traceText", "sourceEpisode", "speaker"}
    assert set(rule["required_properties_by_label"]["ProvenanceEvidence"]) == required


def test_configured_artifact_paths_exist_and_prompt_roles_are_explicit() -> None:
    hospitality = _load(ROOT / "hospitality" / "ingestion config.json")
    hypertension = _load(ROOT / "hypertension" / "ingestion config.json")

    hospitality_paths = hospitality["artifacts"]
    hypertension_paths = hypertension["session"]
    for key in (
        "section_map",
        "provenance_spec",
        "validation_rules",
        "reference_prompt_txt",
        "reference_prompt_docx",
    ):
        assert (ROOT / hospitality_paths[key]).is_file()
    for key in (
        "schema_file",
        "section_map_file",
        "provenance_spec_file",
        "validation_rules_file",
        "reference_prompt_txt",
        "reference_prompt_docx",
    ):
        assert (ROOT / hypertension_paths[key]).is_file()
    assert "export-only" in hospitality_paths["prompt_governance"]
    assert "export-only" in hypertension_paths["prompt_governance"]


def test_export_docx_prompts_match_canonical_txt() -> None:
    for txt, docx in (
        (
            ROOT / "hospitality/prompt Hospitality .txt",
            ROOT / "hospitality/prompt Hospitality .docx",
        ),
        (
            ROOT / "hypertension/Prompt Hypetension.txt",
            ROOT / "hypertension/Prompt Hypetension.docx",
        ),
    ):
        assert _normalized_text(txt.read_text(encoding="utf-8-sig")) == _normalized_text(
            _docx_text(docx)
        )


def test_hospitality_rule_count_and_pricing_scope_are_consistent() -> None:
    base = ROOT / "hospitality"
    validation = _load(base / "validation rules.json")
    documentation = (base / "documentation (1).md").read_text(encoding="utf-8")
    prompts = "\n".join(
        [
            (base / "prompt Hospitality .txt").read_text(encoding="utf-8"),
            (
                ROOT
                / "src/main/python/chatgraph/domains/hospitality/agent_prompt.py"
            ).read_text(encoding="utf-8"),
            (ROOT / "lib/prompts.ts").read_text(encoding="utf-8"),
        ]
    ).lower()
    assert len(validation["rules"]) == 25
    assert "25 validation rules" in documentation
    assert "pricing and timing judgments" not in prompts
    assert "timing, pricing" not in prompts


def test_hypertension_prompt_covers_section_b_schema_targets() -> None:
    prompts = "\n".join(
        [
            (ROOT / "hypertension/Prompt Hypetension.txt").read_text(
                encoding="utf-8"
            ),
            (
                ROOT
                / "src/main/python/chatgraph/domains/hypertension/agent_prompt.py"
            ).read_text(encoding="utf-8"),
            (ROOT / "lib/prompts.ts").read_text(encoding="utf-8"),
        ]
    ).lower()
    for concept in (
        "definition",
        "classification",
        "threshold",
        "symptom",
        "modifiable",
        "non-modifiable",
        "risk factor",
    ):
        assert concept in prompts


def test_session_ids_include_time_and_random_suffix_in_both_runtimes() -> None:
    browser = (ROOT / "lib/schema.ts").read_text(encoding="utf-8")
    voice = (
        ROOT / "src/main/python/chatgraph/chat/main.py"
    ).read_text(encoding="utf-8")
    assert "randomUUID()" in browser
    assert "toISOString()" in browser
    assert "uuid4().hex[:8]" in voice
    assert 'strftime("%Y%m%dt%H%M%S%f")' in voice


def test_python_section_state_requires_explicit_transition() -> None:
    path = ROOT / "src/main/python/chatgraph/chat/section_state.py"
    spec = importlib.util.spec_from_file_location("section_state_contract", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert module.next_section_order(
        2, 7, module.DEEP_DIVE_QUESTION, "No, move on."
    ) == 3
    assert module.next_section_order(
        2, 7, module.DEEP_DIVE_QUESTION, "Yes, let's go deeper."
    ) == 2
    assert module.next_section_order(
        7, 7, module.MOVE_NEXT_QUESTION, "Yes."
    ) == 7


def test_runtime_enforces_provenance_reuse_and_transactions() -> None:
    extractor = (
        ROOT / "src/main/python/chatgraph/chat/extractor.py"
    ).read_text(encoding="utf-8")
    writer = (
        ROOT / "src/main/python/chatgraph/chat/graph_writer.py"
    ).read_text(encoding="utf-8")
    coordinator = (
        ROOT / "src/main/python/chatgraph/chat/main.py"
    ).read_text(encoding="utf-8")
    browser = (ROOT / "lib/schema.ts").read_text(encoding="utf-8")
    graph_config = (
        ROOT / "config/gremlin/chatgraph-tinkergraph.properties"
    ).read_text(encoding="utf-8")

    assert "_validate_provenance_contract" in extractor
    assert "canonical_ids" in extractor
    assert "findCanonicalVertex" in browser
    assert "has no schema-valid provenance edge in this delta" in browser
    assert "tx.commit()" in writer
    assert "tx.rollback()" in writer
    assert "TinkerTransactionGraph" in graph_config
    assert "_extraction_lock" in coordinator
    assert "_ensure_active_section" in coordinator
    assert "transaction-capable Gremlin backend" in coordinator

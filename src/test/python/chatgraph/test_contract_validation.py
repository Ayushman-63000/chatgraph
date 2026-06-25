"""Session-close validation behavior for expert domains."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import pytest

core = pytest.importorskip("hydra.core")
pg = pytest.importorskip("hydra.pg.model")
FrozenDict = pytest.importorskip("hydra.dsl.python").FrozenDict

ROOT = Path(__file__).resolve().parents[4]
PATH = ROOT / "src/main/python/chatgraph/chat/contract_validation.py"
SPEC = importlib.util.spec_from_file_location("expert_contract_validation", PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
validate_session_graph = MODULE.validate_session_graph


def _string(value: str):
    return core.LiteralString(value)


def _vertex(label: str, vertex_id: str, **properties):
    return pg.Vertex(
        label=pg.VertexLabel(label),
        id=_string(vertex_id),
        properties=FrozenDict({
            pg.PropertyKey(key): _string(str(value))
            for key, value in properties.items()
        }),
    )


def _graph(vertices, edges=()):
    return pg.Graph(
        vertices=FrozenDict({vertex.id: vertex for vertex in vertices}),
        edges=FrozenDict({edge.id: edge for edge in edges}),
    )


def test_hospitality_close_reports_singletons_coverage_and_orphan_provenance() -> None:
    graph = _graph([
        _vertex("SessionSection", "section:session:hospitality:test:1", sectionType="introduction"),
        _vertex(
            "ProvenanceEvidence",
            "prov:ep:session:hospitality:test:99:01",
            sourceEpisode="ep:session:hospitality:test:99",
        ),
    ])
    findings = validate_session_graph(graph, "hospitality")
    rule_ids = {finding.rule_id for finding in findings}
    assert {"HR016", "HR019", "HR020", "HR024", "HR025"} <= rule_ids


def test_hypertension_close_warns_on_implausible_bp() -> None:
    measurement = pg.Vertex(
        label=pg.VertexLabel("BloodPressureMeasurement"),
        id=_string("bp:clinic:01"),
        properties=FrozenDict({
            pg.PropertyKey("systolic"): core.LiteralInteger(
                core.IntegerValueInt32(350)
            )
        }),
    )
    findings = validate_session_graph(_graph([measurement]), "hypertension")
    assert [finding.rule_id for finding in findings] == ["R011"]

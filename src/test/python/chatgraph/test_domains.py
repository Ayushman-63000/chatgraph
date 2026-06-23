"""Domain registry and schema-isolation contracts."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[4]

DOMAIN_ARTIFACTS = {
    "medical": {
        "schema": ROOT / "src/main/json/medical.json",
        "agent": ROOT / "src/main/python/chatgraph/domains/medical/agent_prompt.py",
        "extractor": ROOT / "src/main/python/chatgraph/domains/medical/extractor_prompt.py",
    },
    "hypertension": {
        "schema": ROOT / "hypertension/hypertension schema.json",
        "agent": ROOT / "src/main/python/chatgraph/domains/hypertension/agent_prompt.py",
        "extractor": ROOT / "src/main/python/chatgraph/domains/hypertension/extractor_prompt.py",
        "section_map": ROOT / "hypertension/section map.json",
        "validation": ROOT / "hypertension/validation rules.json",
    },
    "hospitality": {
        "schema": ROOT / "hospitality/schema hospitality.json",
        "agent": ROOT / "src/main/python/chatgraph/domains/hospitality/agent_prompt.py",
        "extractor": ROOT / "src/main/python/chatgraph/domains/hospitality/extractor_prompt.py",
        "section_map": ROOT / "hospitality/section map.json",
        "provenance": ROOT / "hospitality/provenance spec.json",
        "validation": ROOT / "hospitality/validation rules.json",
    },
}


def _labels(path: Path) -> tuple[set[str], set[str]]:
    schema = json.loads(path.read_text(encoding="utf-8"))
    return (
        {entry["@key"] for entry in schema["vertices"]},
        {entry["@key"] for entry in schema["edges"]},
    )


class DomainRegistryTests(unittest.TestCase):
    def test_registry_contains_three_complete_domains(self) -> None:
        self.assertEqual(set(DOMAIN_ARTIFACTS), {"medical", "hypertension", "hospitality"})
        for artifacts in DOMAIN_ARTIFACTS.values():
            for path in artifacts.values():
                self.assertTrue(path.is_file(), path)
                self.assertTrue(path.read_text(encoding="utf-8").strip(), path)

        web_registry = (ROOT / "lib/domains.ts").read_text(encoding="utf-8")
        for domain_id in ("headache", "hypertension", "hospitality"):
            self.assertIn(f'{domain_id}: {{', web_registry)
        self.assertIn('export type DomainId = "headache" | "hypertension" | "hospitality"', (
            ROOT / "lib/types.ts"
        ).read_text(encoding="utf-8"))

    def test_each_domain_derives_distinct_schema_constraints(self) -> None:
        medical_vertices, medical_edges = _labels(DOMAIN_ARTIFACTS["medical"]["schema"])
        hypertension_vertices, hypertension_edges = _labels(
            DOMAIN_ARTIFACTS["hypertension"]["schema"]
        )
        hospitality_vertices, hospitality_edges = _labels(
            DOMAIN_ARTIFACTS["hospitality"]["schema"]
        )

        self.assertIn("Headache", medical_vertices)
        self.assertNotIn("Headache", hypertension_vertices)
        self.assertNotIn("Headache", hospitality_vertices)
        self.assertIn("BloodPressureMeasurement", hypertension_vertices)
        self.assertNotIn("BloodPressureMeasurement", hospitality_vertices)
        self.assertIn("GuestExperiencePrinciple", hospitality_vertices)
        self.assertNotIn("GuestExperiencePrinciple", hypertension_vertices)
        self.assertIn("reports", medical_edges)
        self.assertIn("conceptSupportedBy", hypertension_edges)
        self.assertIn("principleSupportedBy", hospitality_edges)

    def test_prompt_content_does_not_cross_domains(self) -> None:
        medical = DOMAIN_ARTIFACTS["medical"]["agent"].read_text(encoding="utf-8").lower()
        hypertension_agent = DOMAIN_ARTIFACTS["hypertension"]["agent"].read_text(
            encoding="utf-8"
        ).lower()
        hypertension_extractor = DOMAIN_ARTIFACTS["hypertension"]["extractor"].read_text(
            encoding="utf-8"
        ).lower()
        hospitality_agent = DOMAIN_ARTIFACTS["hospitality"]["agent"].read_text(
            encoding="utf-8"
        ).lower()
        hospitality_extractor = DOMAIN_ARTIFACTS["hospitality"]["extractor"].read_text(
            encoding="utf-8"
        ).lower()

        self.assertIn("headache", medical)
        self.assertNotIn("hospitality business owner", medical)
        self.assertIn("hypertension", hypertension_agent)
        self.assertNotIn("guestexperienceprinciple", hypertension_extractor)
        self.assertIn("hospitality", hospitality_agent)
        self.assertNotIn("bloodpressuremeasurement", hospitality_extractor)

    def test_browser_passes_one_domain_to_agent_extractor_and_validator(self) -> None:
        page = (ROOT / "app/page.tsx").read_text(encoding="utf-8")
        chat_route = (ROOT / "app/api/chat/route.ts").read_text(encoding="utf-8")
        extractor = (ROOT / "lib/server/extract.ts").read_text(encoding="utf-8")
        schema = (ROOT / "lib/schema.ts").read_text(encoding="utf-8")

        self.assertGreaterEqual(page.count("domainId:"), 2)
        self.assertIn("getDomain(body.domainId)", chat_route)
        self.assertIn("extractGraphDelta(openai, latestUser.content, body)", chat_route)
        self.assertIn("getDomain(body.domainId)", extractor)
        self.assertIn("activeSectionOrder(body.domainId, body.graph, body.messages)", extractor)
        self.assertIn("sanitizeDelta(", extractor)
        self.assertIn("sectionOrder", extractor)
        self.assertIn("schemaReference(body.domainId)", extractor)
        self.assertIn("graphMatchesDomain", schema)

    def test_hospitality_uses_canonical_schema_and_intro_scope(self) -> None:
        registry = (ROOT / "lib/domains.ts").read_text(encoding="utf-8")
        schema = json.loads(
            (ROOT / "hospitality/schema hospitality.json").read_text(encoding="utf-8")
        )
        section_map = json.loads(
            (ROOT / "hospitality/section map.json").read_text(encoding="utf-8")
        )
        intro = section_map["sections"][0]

        self.assertIn(
            'import hospitalitySchemaRaw from "../hospitality/schema hospitality.json"',
            registry,
        )
        self.assertEqual(
            set(intro["primary_vertex_labels"]),
            {
                "Person",
                "KnowledgeSession",
                "SessionSection",
                "TranscriptEpisode",
                "ProvenanceEvidence",
            },
        )
        self.assertEqual(
            {pattern["edge"] for pattern in intro["edge_patterns"]},
            {"hasSession", "hasSection", "hasEpisode"},
        )
        labels = {entry["@key"] for entry in schema["vertices"]}
        self.assertNotIn("HotelType", labels)
        self.assertNotIn("RoomCount", labels)

    def test_voice_failure_is_explicit_and_opening_is_replayable(self) -> None:
        page = (ROOT / "app/page.tsx").read_text(encoding="utf-8")
        speech = (ROOT / "lib/speech.ts").read_text(encoding="utf-8")

        self.assertIn('aria-label="Play this reply"', page)
        self.assertIn("void speak(opening.content)", page)
        self.assertIn("Voice playback was blocked or unavailable", speech)


if __name__ == "__main__":
    unittest.main()

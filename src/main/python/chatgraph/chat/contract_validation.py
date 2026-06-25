"""Full-session validation for expert-domain graphs."""

from __future__ import annotations

from dataclasses import dataclass

import hydra.pg.model as pg


@dataclass(frozen=True)
class AuditFinding:
    rule_id: str
    severity: str
    message: str


def validate_session_graph(graph: pg.Graph, domain_name: str) -> list[AuditFinding]:
    if domain_name not in {"hypertension", "hospitality"}:
        return []
    vertices = list(graph.vertices.values())
    edges = list(graph.edges.values())
    findings: list[AuditFinding] = []

    def by_label(label: str):
        return [vertex for vertex in vertices if vertex.label.value == label]

    def prop(vertex, key: str):
        value = vertex.properties.get(pg.PropertyKey(key))
        return getattr(value, "value", None)

    episode_ids = {vertex.id.value for vertex in by_label("TranscriptEpisode")}
    for evidence in by_label("ProvenanceEvidence"):
        source = str(prop(evidence, "sourceEpisode") or "")
        if source not in episode_ids:
            findings.append(AuditFinding(
                "HR025" if domain_name == "hospitality" else "PV002",
                "soft",
                f"Provenance {evidence.id.value} references missing episode {source}.",
            ))

    if domain_name == "hypertension":
        for measurement in by_label("BloodPressureMeasurement"):
            systolic = prop(measurement, "systolic")
            diastolic = prop(measurement, "diastolic")
            if (
                isinstance(systolic, int) and not 60 <= systolic <= 300
            ) or (
                isinstance(diastolic, int) and not 30 <= diastolic <= 200
            ):
                findings.append(AuditFinding(
                    "R011",
                    "soft",
                    f"Blood pressure measurement {measurement.id.value} is physiologically implausible.",
                ))
        return findings

    section_types = {
        str(prop(vertex, "sectionType")) for vertex in by_label("SessionSection")
    }
    for section_type, title in (
        ("introduction", "Introduction"),
        ("guest_experience_principles", "Guest Experience Principles"),
        ("arrival_checkin_timing", "Arrival, Check-In, and Timing"),
    ):
        if section_type not in section_types:
            findings.append(AuditFinding(
                "HR016", "soft", f"Missing required section: {title}."
            ))

    for label, rule_id in (
        ("GuestPersona", "HR017"),
        ("GuestSignal", "HR018"),
    ):
        counts: dict[str, int] = {}
        for vertex in by_label(label):
            name = " ".join(str(prop(vertex, "name") or "").lower().split())
            if name:
                counts[name] = counts.get(name, 0) + 1
        for name, count in counts.items():
            if count > 1:
                findings.append(AuditFinding(
                    rule_id,
                    "soft",
                    f"{count} {label} vertices share normalized name {name!r}.",
                ))

    for label, rule_id in (
        ("CheckInPolicy", "HR019"),
        ("CheckOutPolicy", "HR020"),
    ):
        count = len(by_label(label))
        if count != 1:
            findings.append(AuditFinding(
                rule_id, "soft", f"Expected exactly one {label}; found {count}."
            ))

    for failure in by_label("ServiceFailure"):
        if not any(
            edge.out.value == failure.id.value and edge.label.value == "resolvedBy"
            for edge in edges
        ):
            findings.append(AuditFinding(
                "HR021",
                "advisory",
                f"ServiceFailure {failure.id.value} has no recovery action.",
            ))

    for rule in by_label("DecisionRule"):
        incoming = any(edge.in_.value == rule.id.value for edge in edges)
        outgoing = any(
            edge.out.value == rule.id.value and edge.label.value != "supportedBy"
            for edge in edges
        )
        if not incoming or not outgoing:
            findings.append(AuditFinding(
                "HR022",
                "advisory",
                f"DecisionRule {rule.id.value} lacks incoming or causal outgoing context.",
            ))

    for loyalty in by_label("LoyaltyDriver"):
        if not any(
            edge.out.value == loyalty.id.value
            and edge.label.value in {"drivenBy", "loyaltyLeadsTo"}
            for edge in edges
        ):
            findings.append(AuditFinding(
                "HR023",
                "advisory",
                f"LoyaltyDriver {loyalty.id.value} is not linked to a persona or outcome.",
            ))

    for label, minimum in {
        "GuestExperiencePrinciple": 3,
        "DecisionRule": 3,
        "GuestPersona": 2,
        "OperatingHeuristic": 2,
        "TimingRule": 1,
    }.items():
        count = len(by_label(label))
        if count < minimum:
            findings.append(AuditFinding(
                "HR024",
                "advisory",
                f"{label} count {count} is below expected minimum {minimum}.",
            ))
    return findings

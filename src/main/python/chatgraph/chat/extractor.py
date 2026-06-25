"""Per-utterance property-graph extractor.

Calls Claude Haiku 4.5 with the patient's latest utterance plus a rolling
window of prior turns, and asks it to emit a small delta of new vertices
and edges that match the headache GraphSchema. The delta is materialised
as ``hydra.pg.model.Vertex`` and ``Edge`` values with deterministic ids
so re-extractions don't duplicate vocabulary items in the live graph.

The allow-lists of vertex and edge labels are derived from the committed
``src/main/json/medical.json`` at import time, so the extractor stays
in sync with whatever the schema currently looks like without manual
mirroring.

Vertex id strategy
------------------
- Vocabulary vertices with a ``value`` (e.g. ``IngestedTrigger``,
  ``Quality``, ``BodyLocation``, ``Severity``, ``Frequency``, ``Age``):
  ``"{label}:{value-or-slug}"``. The same concept across utterances
  reduces to a single vertex.
- Bare-label vertex types with no payload (concrete symptoms like
  ``Nausea``, ``LightSensitivity``, autonomic features, aura subtypes,
  red flags, prodromal symptoms): the id is just the label, since the
  label IS the meaning.
- ``Headache``: ``"Headache:{slug}"`` minted on first introduction of a
  named pattern. The orchestrator threads the id back into
  ``RollingContext.known_headaches`` so subsequent calls reuse it.
- Per-headache buckets (``HeadacheTriggers``, ``AlleviatingFactors``,
  ``Prodrome``, ``Aura``, ``Postdrome``, ``PainCharacter``): one bucket
  per Headache, id pattern ``"{type}:{headache-suffix}"``.
- ``Comment``: a fresh uuid-like id each time.
- ``Concept`` (reification indirection for Comment edges): ``"c:" +
  underlying_vocab_id`` so the same underlying vocabulary item shares
  one Concept indirection.

Edge ids are deterministic: ``"{out_id}-{label}->{in_id}"``.

Validation loop
---------------
Each materialised delta is validated against the domain's typed
``hydra.pg.model.GraphSchema`` (loaded once at construction) via
``chatgraph.chat.validation.validate_delta``. On failure the typed
error is echoed back to Claude Haiku as a ``tool_result`` and the
call is retried, up to ``MAX_EXTRACTION_ATTEMPTS`` total attempts.
After exhausting the budget the utterance's delta is dropped (logged
but not written) and the conversation continues.

A delta's edges usually reference vertices in the *live* graph from
prior turns (most notably the ``Person`` root that every ``reports``
edge points out of). Validation resolves those endpoints against
``RollingContext.vertex_labels`` -- an id->label cache seeded from the
live graph at session start and grown as each validated delta is
written -- so cross-graph edges validate (by label) instead of being
falsely rejected as dangling. See ``chatgraph.chat.validation`` for the
full rationale.

Failures (API errors, malformed extractions, exhausted retries) are
logged and swallowed -- the conversation never blocks on the graph.
"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import anthropic
import hydra.core as core
import hydra.pg.model as pg
from hydra.dsl.python import FrozenDict
from hydrapop.decode import decode_graph_schema

if TYPE_CHECKING:
    from chatgraph.domains import Domain

log = logging.getLogger(__name__)


DEFAULT_MODEL = "claude-haiku-4-5-20251001"

# Max number of extraction attempts per utterance, counting the initial
# attempt. With ``MAX_EXTRACTION_ATTEMPTS = 3``, the extractor tries
# once and then up to two corrective retries if validation fails before
# giving up and dropping the utterance's delta.
MAX_EXTRACTION_ATTEMPTS = 3

_IDENTITY_PROPERTY_BY_LABEL = {
    "GuestExperiencePrinciple": "name",
    "ServiceStandard": "name",
    "GuestSignal": "name",
    "GuestPersona": "name",
    "TimingRule": "ruleText",
    "ServiceFailure": "name",
    "RecoveryAction": "name",
    "ExceptionRule": "ruleText",
    "DecisionRule": "ruleText",
    "OperatingHeuristic": "name",
    "LoyaltyDriver": "name",
    "EmotionalMoment": "name",
    "HypertensionConcept": "name",
    "DiagnosticCriterion": "criterionName",
    "ClinicalFinding": "name",
    "Symptom": "name",
    "Comorbidity": "name",
    "RiskFactor": "name",
    "SecondaryCause": "name",
    "DiagnosticTest": "testName",
    "Medication": "name",
    "LifestyleIntervention": "name",
    "ClinicalReasoningPattern": "patternName",
    "Pitfall": "description",
}

_SINGLETON_LABELS = {
    "Person",
    "KnowledgeSession",
    "CheckInPolicy",
    "CheckOutPolicy",
}

_ID_PREFIX_BY_LABEL = {
    "Person": "person:",
    "KnowledgeSession": "session:",
    "SessionSection": "section:",
    "TranscriptEpisode": "ep:",
    "ProvenanceEvidence": "prov:",
    "GuestExperiencePrinciple": "principle:",
    "ServiceStandard": "standard:",
    "GuestSignal": "signal:",
    "GuestPersona": "persona:",
    "CheckInPolicy": "policy:checkin:",
    "CheckOutPolicy": "policy:checkout:",
    "TimingRule": "timing:",
    "ServiceFailure": "failure:",
    "RecoveryAction": "recovery:",
    "ExceptionRule": "exception:",
    "DecisionRule": "rule:",
    "OperatingHeuristic": "heuristic:",
    "LoyaltyDriver": "loyalty:",
    "EmotionalMoment": "moment:",
    "HypertensionConcept": "concept:",
    "BloodPressureMeasurement": "bp:",
    "DiagnosticCriterion": "criterion:",
    "ClinicalFinding": "finding:",
    "Symptom": "symptom:",
    "Comorbidity": "comorbidity:",
    "RiskFactor": "riskfactor:",
    "SecondaryCause": "secondary:",
    "DiagnosticTest": "test:",
    "Medication": "med:",
    "LifestyleIntervention": "lifestyle:",
    "FollowUpPlan": "followup:",
    "ClinicalReasoningPattern": "pattern:",
    "Pitfall": "pitfall:",
    "CaseScenario": "case:",
    "ContextualConstraint": "constraint:",
    "Outcome": "outcome:",
}


def _identity_key(label: str, properties: dict) -> tuple[str, str] | None:
    property_name = _IDENTITY_PROPERTY_BY_LABEL.get(label)
    if not property_name:
        return None
    value = properties.get(property_name)
    if hasattr(value, "value"):
        value = value.value
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = " ".join(value.lower().split())
    return label, normalized

def _allowlists_from_schema(schema: dict) -> tuple[
    dict[str, set[str]],
    dict[str, tuple[str, str]],
    dict[str, set[str]],
    tuple[str, ...],
]:
    """Derive (allowed_vertex_props, allowed_edges, allowed_edge_props,
    vocabulary_labels) from a parsed schema-JSON dict.

    Reading the schema as the source of truth eliminates the drift class
    where the schema gains a new label or property but the extractor
    still drops it as "unknown".
    """
    allowed_vertex_props: dict[str, set[str]] = {}
    for entry in schema["vertices"]:
        label = entry["@key"]
        props = {p["key"] for p in entry["@value"].get("properties", [])}
        allowed_vertex_props[label] = props

    allowed_edges: dict[str, tuple[str, str]] = {}
    allowed_edge_props: dict[str, set[str]] = {}
    for entry in schema["edges"]:
        label = entry["@key"]
        v = entry["@value"]
        allowed_edges[label] = (v["out"], v["in"])
        allowed_edge_props[label] = {p["key"] for p in v.get("properties", [])}

    vocabulary = tuple(
        label for label in allowed_vertex_props if label not in {"Comment", "Concept"}
    )
    return allowed_vertex_props, allowed_edges, allowed_edge_props, vocabulary


def _literal_type_name(value: dict) -> str:
    """Render a property's JSON literal-type node as a short string.

    The schema encodes a property type as a single-key dict, e.g.
    ``{"string": {}}`` -> ``"string"`` or ``{"integer": {"int32": {}}}``
    -> ``"int32"``. Returns the innermost type name so the prompt shows
    the model exactly what JSON scalar a property expects (the chief
    cause of validation retries is emitting the wrong scalar type).
    """
    node = value
    name = "?"
    # Walk down single-key wrapper dicts to the most specific name.
    while isinstance(node, dict) and node:
        name = next(iter(node))
        node = node[name]
    return name


def _prop_types_from_schema(
    schema: dict,
) -> dict[str, dict[str, tuple[str, bool]]]:
    """Map ``element-label -> {prop-key: (type-name, required)}`` for both
    vertices and edges, derived from the same parsed schema JSON used by
    ``_allowlists_from_schema``.

    Used only to annotate the prompt's schema reference with literal
    types and required-ness; the allow-list/membership logic still uses
    the plain property-name sets, so this carries no risk to the
    materializer or tool spec.
    """
    out: dict[str, dict[str, tuple[str, bool]]] = {}
    for section in ("vertices", "edges"):
        for entry in schema[section]:
            label = entry["@key"]
            detail: dict[str, tuple[str, bool]] = {}
            for p in entry["@value"].get("properties", []):
                detail[p["key"]] = (
                    _literal_type_name(p.get("value", {})),
                    bool(p.get("required", False)),
                )
            out[label] = detail
    return out


@dataclass
class RollingContext:
    """Short conversational context for the extractor.

    Carries the last few turns (for anaphora resolution) plus the set of
    Headache patterns the patient has already named, so the extractor
    can reuse those ids instead of inventing a fresh Headache vertex on
    each utterance.
    """

    window: deque = field(default_factory=lambda: deque(maxlen=4))
    # The id of the Person vertex representing the patient. Set at
    # session start (either by creating a fresh Person or discovering
    # the existing one in the graph). Every Headache the extractor mints
    # should be connected to this Person via a `reports` edge.
    person_id: str | None = None
    # Known Headache patterns: id -> short natural-language label
    # ("daily", "acute", "morning", ...). The extractor is asked to reuse
    # an existing id when an utterance is about a previously-named
    # pattern, and to mint a fresh id ONLY when the patient introduces a
    # genuinely new pattern.
    known_headaches: dict = field(default_factory=dict)
    # Convenience pointer to the most recently discussed Headache id; the
    # extractor still gets this as a default when the utterance is
    # ambiguous about which pattern is meant.
    current_headache_id: str | None = None
    # True after the patient has signaled they're done. Flips back to
    # False if the patient resumes substantive content.
    session_done: bool = False
    # Known per-Headache "bucket" vertices: maps bucket vertex label
    # (HeadacheTriggers, AlleviatingFactors, Prodrome, Aura, Postdrome,
    # PainCharacter) to a dict of {bucket_id: {headache_id, ...}}. When
    # the patient says "the triggers are the same across patterns" the
    # extractor should emit a `triggers` edge from BOTH Headaches to the
    # SAME bucket vertex rather than creating parallel buckets.
    known_buckets: dict = field(default_factory=dict)
    # Vertex id -> vertex-label string for every vertex believed to exist
    # in the live graph: seeded once from the graph at session start
    # (incl. the Person root) and grown as each validated delta is
    # written. Used by validate_delta to resolve edge endpoints that
    # reference live-graph vertices (e.g. the `reports` edge out of the
    # Person root) without falsely rejecting them as dangling. See
    # chatgraph.chat.validation for the full rationale.
    vertex_labels: dict = field(default_factory=dict)
    utterance_sequence: int = 0
    episode_sequence: int = 0
    active_section_order: int = 1
    active_question_index: int = 0
    canonical_ids: dict[tuple[str, str], str] = field(default_factory=dict)
    singleton_ids: dict[str, str] = field(default_factory=dict)

    BUCKET_LABELS = (
        "HeadacheTriggers", "AlleviatingFactors",
        "Prodrome", "Aura", "Postdrome", "PainCharacter",
    )

    def __post_init__(self) -> None:
        # If constructed with a person_id, treat the Person root as a
        # known live-graph vertex so the first `reports` edge resolves.
        # (The runtime sets person_id via _ensure_person, which seeds the
        # cache itself; this covers callers that pass it to __init__.)
        if self.person_id and self.person_id not in self.vertex_labels:
            self.vertex_labels[self.person_id] = "Person"

    def add(self, speaker: str, text: str) -> None:
        self.window.append({"speaker": speaker, "text": text})
        if speaker in {"patient", "expert", "agent", "interviewer"}:
            self.episode_sequence += 1
        if speaker in {"patient", "expert"}:
            self.utterance_sequence += 1

    def as_history(self) -> list[dict]:
        return list(self.window)

    def register_headache(self, headache_id: str, label: str | None = None) -> None:
        """Record a Headache id so the extractor knows to reuse it."""
        self.known_headaches.setdefault(headache_id, label or "")
        self.current_headache_id = headache_id

    def register_vertices(self, vertices) -> None:
        """Record (id -> label) for every vertex now believed to be in the
        live graph, so subsequent deltas can anchor edges to them.

        ``vertices`` is an iterable of ``hydra.pg.model.Vertex``. Called
        once at session start (seeded from the live graph) and after each
        validated delta is written.
        """
        for v in vertices:
            self.vertex_labels[v.id.value] = v.label.value
            properties = {
                key.value: getattr(value, "value", value)
                for key, value in v.properties.items()
            }
            identity = _identity_key(v.label.value, properties)
            if identity is not None:
                self.canonical_ids.setdefault(identity, v.id.value)
            if v.label.value in _SINGLETON_LABELS:
                self.singleton_ids.setdefault(v.label.value, v.id.value)

    def register_bucket(
        self, bucket_label: str, bucket_id: str, headache_id: str | None = None
    ) -> None:
        """Record that a bucket vertex exists, optionally with the
        Headache that points at it."""
        if bucket_label not in self.BUCKET_LABELS:
            return
        per_label = self.known_buckets.setdefault(bucket_label, {})
        owners = per_label.setdefault(bucket_id, set())
        if headache_id:
            owners.add(headache_id)

    def buckets_summary(self) -> str:
        """Render known buckets for the extractor prompt. Empty string if
        no buckets are known yet."""
        if not self.known_buckets:
            return ""
        lines = ["Known buckets (Headaches sharing a bucket should not get a duplicate):"]
        for bucket_label in self.BUCKET_LABELS:
            entries = self.known_buckets.get(bucket_label, {})
            if not entries:
                continue
            for bid, owners in entries.items():
                owners_str = (
                    ", ".join(sorted(owners)) if owners else "(no Headache attached yet)"
                )
                lines.append(
                    f"  - {bucket_label}: id={bid!r} attached to: {owners_str}"
                )
        return "\n".join(lines)

    def known_headaches_summary(self) -> str:
        """Render the known Headaches for the extractor prompt."""
        if not self.known_headaches:
            return "(no Headache patterns recorded yet)"
        lines = []
        for hid, label in self.known_headaches.items():
            marker = " (most recent)" if hid == self.current_headache_id else ""
            lines.append(
                f'  - id={hid!r} label={label!r}{marker}' if label
                else f'  - id={hid!r}{marker}'
            )
        return "\n".join(lines)


def _format_schema_reference(
    allowed_vertex_props: dict[str, set[str]],
    allowed_edges: dict[str, tuple[str, str]],
    allowed_edge_props: dict[str, set[str]],
    prop_types: dict[str, dict[str, tuple[str, bool]]] | None = None,
) -> str:
    """Render the schema as a compact reference appended to the system
    prompt. Auto-generated so it stays in sync with the JSON.

    When ``prop_types`` (label -> {prop: (type-name, required)}) is given,
    each property is annotated with its literal type and a trailing ``!``
    if required, e.g. ``value:string!, scale:int32``. This tells the model
    the exact JSON scalar a property expects up front, which is the chief
    cause of validation retries.
    """
    prop_types = prop_types or {}

    def render_props(label: str, props: list[str]) -> str:
        detail = prop_types.get(label, {})
        rendered = []
        for p in props:
            if p in detail:
                type_name, required = detail[p]
                rendered.append(f"{p}:{type_name}{'!' if required else ''}")
            else:
                rendered.append(p)
        return ", ".join(rendered)

    # Vertex labels with their property list.
    v_lines = []
    for label in sorted(allowed_vertex_props):
        props = sorted(allowed_vertex_props[label])
        if props:
            v_lines.append(f"  {label}: properties = {{{render_props(label, props)}}}")
        else:
            v_lines.append(f"  {label}: (no properties)")

    # Edges grouped by out-label so the model can scan "what edges go
    # out from Headache" quickly. Edge properties are shown inline when
    # present so the model knows the allowed keys.
    edges_by_out: dict[str, list[tuple[str, str]]] = {}
    for label, (out, in_) in allowed_edges.items():
        edges_by_out.setdefault(out, []).append((label, in_))
    e_lines = []
    for out in sorted(edges_by_out):
        for elabel, in_ in sorted(edges_by_out[out]):
            props = sorted(allowed_edge_props.get(elabel, ()))
            if props:
                e_lines.append(
                    f"  {elabel}: {out} -> {in_}  "
                    f"(edge props: {render_props(elabel, props)})"
                )
            else:
                e_lines.append(f"  {elabel}: {out} -> {in_}")

    return (
        "VERTEX TYPES (label : allowed properties; prop:type, ! = required):\n"
        + "\n".join(v_lines)
        + "\n\nEDGE TYPES (label : out-vertex -> in-vertex; edge props in parens):\n"
        + "\n".join(e_lines)
    )


def _build_extract_tool(
    allowed_vertex_props: dict[str, set[str]],
    allowed_edges: dict[str, tuple[str, str]],
) -> dict:
    """Build the Anthropic tool-use spec from a domain's allowlists.

    The enum values for ``label`` are taken straight from the schema, so
    the LLM can only emit labels the schema knows about. The signal flags
    (``patient_signaled_done`` / ``patient_resumed`` / ``new_current_headache_id``)
    are domain-agnostic and shipped uniformly.
    """
    return {
        "name": "emit_graph_delta",
        "description": (
            "Emit the new vertices and edges captured from the latest "
            "patient utterance. Emit nothing if the utterance has no "
            "substantive content."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "vertices": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {
                                "type": "string",
                                "enum": sorted(allowed_vertex_props.keys()),
                            },
                            "id": {"type": "string"},
                            "properties": {
                                "type": "object",
                                "additionalProperties": True,
                            },
                        },
                        "required": ["label", "id"],
                    },
                },
                "edges": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {
                                "type": "string",
                                "enum": sorted(allowed_edges.keys()),
                            },
                            "out": {"type": "string"},
                            "in": {"type": "string"},
                            "properties": {
                                "type": "object",
                                "additionalProperties": True,
                                "description": (
                                    "Optional edge properties. Allowed "
                                    "keys depend on the edge label; see "
                                    "the edge property catalog in the "
                                    "system prompt."
                                ),
                            },
                        },
                        "required": ["label", "out", "in"],
                    },
                },
                "new_current_headache_id": {
                    "type": "string",
                    "description": (
                        "Optional. If a new Headache vertex emerged in "
                        "this utterance, the id of that Headache vertex; "
                        "future calls should reuse it as "
                        "current_headache_id. Domain-specific to "
                        "headache interviews; other domains may ignore."
                    ),
                },
                "patient_signaled_done": {
                    "type": "boolean",
                    "description": (
                        "Set true if the latest patient utterance signals "
                        "they're finished discussing the topic at hand "
                        "(\"that's all\", \"I'm done\", \"let's stop\", "
                        "\"I have to go\", etc.). The agent will stop "
                        "asking questions until the patient resumes "
                        "substantive content. Set false otherwise "
                        "(including when the patient just paused or "
                        "said 'okay')."
                    ),
                },
                "patient_resumed": {
                    "type": "boolean",
                    "description": (
                        "Set true if the patient was previously marked "
                        "done but is now offering substantive new "
                        "content. The agent will resume asking "
                        "questions. Set false otherwise."
                    ),
                },
                "schema_gaps": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Hospitality only. Substantive expert knowledge that "
                        "cannot fit any declared schema label or edge. Never "
                        "invent a label."
                    ),
                },
            },
            "required": ["vertices", "edges"],
        },
    }


@dataclass
class ExtractionResult:
    delta: pg.Graph
    new_current_headache_id: str | None = None
    patient_signaled_done: bool = False
    patient_resumed: bool = False
    schema_gaps: tuple[str, ...] = ()


class Extractor:
    """Per-utterance graph-delta extractor.

    Bound to a single :class:`~chatgraph.domains.Domain` at construction
    time. The domain provides the schema (which determines the
    allowlists and the tool's enum), the headache-flavoured intro to the
    system prompt, and the agent's stylistic preferences. The
    schema-driven part of the system prompt and the tool spec are built
    once per Extractor instance.
    """

    def __init__(
        self,
        domain: "Domain",
        api_key: str | None = None,
        model: str | None = None,
    ) -> None:
        api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model or os.environ.get(
            "CHATGRAPH_EXTRACTOR_MODEL", DEFAULT_MODEL
        )
        self._domain = domain

        # The committed schema JSON drives two parts of the extractor:
        #   - allow-list dicts that the tool spec and materializer use
        #     to filter unknown labels and unknown properties; and
        #   - a typed ``hydra.pg.model.GraphSchema`` used to validate
        #     each delta before it is written.
        # Load the JSON once, then derive both.
        with open(domain.schema_path) as _f:
            schema_json = json.load(_f)
        (
            self._allowed_vertex_props,
            self._allowed_edges,
            self._allowed_edge_props,
            self._vocabulary_labels,
        ) = _allowlists_from_schema(schema_json)
        self._prop_types = _prop_types_from_schema(schema_json)
        self._schema = decode_graph_schema(schema_json)
        self._provenance_edge_by_vertex: dict[str, str] = {}
        if domain.provenance_spec_path is not None:
            with domain.provenance_spec_path.open(encoding="utf-8") as handle:
                provenance_spec = json.load(handle)
            self._provenance_edge_by_vertex = provenance_spec.get(
                "attachment_rules", {}
            ).get("edge_label_by_vertex", {})
        self._sections: dict[int, dict] = {}
        if domain.section_map_path is not None:
            with domain.section_map_path.open(encoding="utf-8") as handle:
                section_map = json.load(handle)
            self._sections = {
                int(section["order"]): section
                for section in section_map.get("sections", [])
            }

        # System prompt = domain-supplied intro + schema reference.
        self._system_prompt = domain.extractor_prompt_intro + _format_schema_reference(
            self._allowed_vertex_props,
            self._allowed_edges,
            self._allowed_edge_props,
            self._prop_types,
        )

        # Tool spec is schema-driven (enum values for label come from
        # the allowlists) so the LLM can't emit unknown labels.
        self._tool = _build_extract_tool(
            self._allowed_vertex_props, self._allowed_edges,
        )

    async def extract(
        self, utterance: str, context: RollingContext
    ) -> ExtractionResult:
        """Run extraction over one patient utterance.

        Returns an ExtractionResult with the new vertices and edges plus an
        optional new current_headache_id. The materialized delta is
        validated against the domain's Hydra GraphSchema; if validation
        fails, the extractor is asked to correct its output and the call
        is retried (up to ``MAX_EXTRACTION_ATTEMPTS`` total attempts).
        After exhausting retries, returns an empty result. On any other
        failure, also returns an empty result; never raises.
        """
        from chatgraph.chat.validation import validate_delta
        from chatgraph.chat.interview import (
            InterviewState,
            current_question_minimum_words,
        )

        if (
            self._domain.name == "hospitality"
            and current_question_minimum_words(
                self._domain.name,
                InterviewState(
                    section_order=context.active_section_order,
                    question_index=context.active_question_index,
                ),
            ) > 1
            and len(utterance.strip().split()) < 5
            and re.fullmatch(
                r"(yes|no|okay|ok|sure|exactly|mm+hmm|can you repeat that)",
                utterance.strip().lower(),
            )
        ):
            return _ensure_expert_episode(
                ExtractionResult(delta=_empty_graph()),
                utterance=utterance,
                context=context,
            )

        user_msg = self._build_user_message(utterance, context)
        allowed_vertex_props = self._allowed_vertex_props
        allowed_edges = self._allowed_edges
        allowed_edge_props = self._allowed_edge_props
        section = self._sections.get(context.active_section_order)
        if section is not None:
            section_labels = set(section.get("primary_vertex_labels", []))
            section_labels.update({
                "SessionSection",
                "TranscriptEpisode",
                "ProvenanceEvidence",
            })
            allowed_vertex_props = {
                label: props
                for label, props in self._allowed_vertex_props.items()
                if label in section_labels
            }
            section_edge_labels = {
                pattern["edge"]
                for pattern in section.get("edge_patterns", [])
            }
            section_edge_labels.update({
                label
                for label, (_, in_label) in self._allowed_edges.items()
                if in_label == "ProvenanceEvidence"
            })
            section_edge_labels.update({"hasEpisode", "hasSection"})
            allowed_edges = {
                label: endpoints
                for label, endpoints in self._allowed_edges.items()
                if label in section_edge_labels
            }
            allowed_edge_props = {
                label: props
                for label, props in self._allowed_edge_props.items()
                if label in section_edge_labels
            }
        tool = _build_extract_tool(allowed_vertex_props, allowed_edges)
        # Mutable message history: grows with each corrective retry so
        # the model can see its prior tool_use and the validation feedback.
        messages: list[dict] = [{"role": "user", "content": user_msg}]

        last_error_message: str | None = None
        for attempt in range(1, MAX_EXTRACTION_ATTEMPTS + 1):
            try:
                resp = await self._client.messages.create(
                    model=self._model,
                    max_tokens=1024,
                    system=self._system_prompt,
                    tools=[tool],
                    tool_choice={"type": "tool", "name": "emit_graph_delta"},
                    messages=messages,
                )
            except Exception:
                log.exception("Extractor: Anthropic call failed")
                return ExtractionResult(delta=_empty_graph())

            tool_use = next(
                (b for b in resp.content if getattr(b, "type", None) == "tool_use"),
                None,
            )
            if tool_use is None:
                log.warning("Extractor: model returned no tool_use block")
                return ExtractionResult(delta=_empty_graph())

            try:
                args = tool_use.input
                if isinstance(args, str):  # defensive
                    args = json.loads(args)
                result = _materialize(
                    args,
                    current_headache_id=context.current_headache_id,
                    allowed_vertex_props=allowed_vertex_props,
                    allowed_edges=allowed_edges,
                    allowed_edge_props=allowed_edge_props,
                    canonical_ids=context.canonical_ids,
                    singleton_ids=context.singleton_ids,
                )
                if self._domain.session_infrastructure:
                    result = _ensure_expert_episode(
                        result,
                        utterance=utterance,
                        context=context,
                    )
            except Exception:
                log.exception("Extractor: failed to materialize delta")
                return ExtractionResult(delta=_empty_graph())

            validation = validate_delta(
                self._schema, result.delta, context.vertex_labels
            )
            contract_error = (
                _validate_domain_contract(
                    result.delta,
                    self._provenance_edge_by_vertex,
                    self._domain.name,
                )
                if validation.is_valid
                else None
            )
            if validation.is_valid and contract_error is None:
                if attempt > 1:
                    log.info(
                        "Extractor: delta valid after %d attempt(s)", attempt
                    )
                return result

            # Result's repr() produces "INVALID - <typed error dump>", which
            # is verbose but identical across Hydra's polyglot bindings.
            last_error_message = contract_error or repr(validation)
            log.warning(
                "Extractor: validation failed (attempt %d/%d): %s",
                attempt, MAX_EXTRACTION_ATTEMPTS, last_error_message,
            )

            if attempt == MAX_EXTRACTION_ATTEMPTS:
                break

            # Re-prompt the model with its prior tool_use and the
            # validation error as a tool_result. The next iteration's
            # messages.create call sees the full corrective context.
            messages.append({"role": "assistant", "content": resp.content})
            messages.append(_validation_feedback_message(
                tool_use_id=tool_use.id, error_message=last_error_message,
            ))

        log.error(
            "Extractor: giving up on utterance after %d failed attempts; "
            "last error: %s",
            MAX_EXTRACTION_ATTEMPTS, last_error_message,
        )
        return ExtractionResult(delta=_empty_graph())

    def _build_user_message(
        self, utterance: str, context: RollingContext
    ) -> str:
        history_lines = [
            f"  {t['speaker']}: {t['text']}" for t in context.as_history()
        ]
        history = "\n".join(history_lines) if history_lines else "  (none)"
        if self._domain.session_infrastructure:
            domain_name = self._domain.name
            session_id = next(
                (
                    vid for vid, label in context.vertex_labels.items()
                    if label == "KnowledgeSession"
                ),
                f"session:{domain_name}:unknown",
            )
            episode_id = (
                f"ep:{session_id}:{max(context.episode_sequence, 1):02d}"
            )
            sections = sorted(
                vid for vid, label in context.vertex_labels.items()
                if label == "SessionSection"
            )
            section = self._sections.get(context.active_section_order, {})
            allowed_labels = ", ".join(section.get("primary_vertex_labels", []))
            allowed_edges = ", ".join(
                pattern["edge"] for pattern in section.get("edge_patterns", [])
            )
            capture_goals = "\n".join(
                f"- {goal}" for goal in section.get("capture_goals", [])
            )
            return (
                f"session_id: {session_id}\n"
                f"episode_id: {episode_id}\n"
                f"active_section_order: {context.active_section_order}\n"
                f"active_section_id: section:{session_id}:{context.active_section_order}\n"
                f"known_section_ids: {sections or ['(none)']}\n\n"
                f"Active section purpose: {section.get('purpose', '')}\n"
                f"Capture goals:\n{capture_goals or '- schema-driven'}\n"
                f"Allowed vertex labels: {allowed_labels or 'schema-driven'}\n"
                f"Allowed edge labels: {allowed_edges or 'schema-driven'}\n"
                f"Section extraction instruction: "
                f"{section.get('extractor_instruction', '')}\n\n"
                f"Recent turns (oldest first):\n{history}\n\n"
                f"Known vertex ids by label:\n{context.vertex_labels}\n\n"
                f"Latest expert utterance:\n  {utterance}"
            )

        current = context.current_headache_id or "(none open)"
        known = context.known_headaches_summary()
        person = context.person_id or "(not yet set)"
        buckets = context.buckets_summary()
        buckets_block = f"\n\n{buckets}" if buckets else ""
        return (
            f"person_id (the patient vertex; use as `out` of every new "
            f"`reports` edge): {person}\n\n"
            f"Recent turns (oldest first):\n{history}\n\n"
            f"Known Headache patterns:\n{known}"
            f"{buckets_block}\n\n"
            f"most_recent_headache_id (default when ambiguous): {current}\n\n"
            f"Latest patient utterance:\n  {utterance}"
        )


def _ensure_expert_episode(
    result: ExtractionResult,
    *,
    utterance: str,
    context: RollingContext,
) -> ExtractionResult:
    session_id = next(
        (
            vertex_id
            for vertex_id, label in context.vertex_labels.items()
            if label == "KnowledgeSession"
        ),
        None,
    )
    if session_id is None:
        return result
    episode_id = f"ep:{session_id}:{max(context.episode_sequence, 1):02d}"
    section_id = f"section:{session_id}:{context.active_section_order}"
    episode_lit = _lit(episode_id)
    episode = pg.Vertex(
        label=pg.VertexLabel("TranscriptEpisode"),
        id=episode_lit,
        properties=FrozenDict({
            pg.PropertyKey("verbatimText"): _lit(utterance),
            pg.PropertyKey("speaker"): _lit("expert"),
        }),
    )
    edge_id = f"{section_id}-hasEpisode->{episode_id}"
    edge_lit = _lit(edge_id)
    edge = pg.Edge(
        label=pg.EdgeLabel("hasEpisode"),
        id=edge_lit,
        out=_lit(section_id),
        in_=episode_lit,
        properties=FrozenDict({}),
    )
    vertices = dict(result.delta.vertices)
    edges = dict(result.delta.edges)
    vertices[episode_lit] = episode
    edges[edge_lit] = edge
    return ExtractionResult(
        delta=pg.Graph(
            vertices=FrozenDict(vertices),
            edges=FrozenDict(edges),
        ),
        new_current_headache_id=result.new_current_headache_id,
        patient_signaled_done=result.patient_signaled_done,
        patient_resumed=result.patient_resumed,
        schema_gaps=result.schema_gaps,
    )


# -- Materialization helpers --


def _empty_graph() -> pg.Graph:
    return pg.Graph(vertices=FrozenDict({}), edges=FrozenDict({}))


def _validation_feedback_message(*, tool_use_id: str, error_message: str) -> dict:
    """Build the corrective ``user`` message sent back to the extractor LLM
    after a validation failure. The next ``messages.create`` call will see
    the original user message, the prior ``tool_use``, and this
    ``tool_result``, and is expected to re-emit a corrected delta.
    """
    return {
        "role": "user",
        "content": [{
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": (
                f"Schema validation failed: {error_message}. "
                f"Re-emit the entire graph delta for this utterance "
                f"with the error corrected."
            ),
            "is_error": True,
        }],
    }


def _lit(s: str):
    return core.LiteralString(s)


def _lit_int(n: int):
    return core.LiteralInteger(core.IntegerValueInt32(int(n)))


def _lit_bool(v: bool):
    return core.LiteralBoolean(bool(v))


def _normalize_vertex_id(vid: str) -> str:
    """Normalize a vertex id so equivalent natural-language values
    collapse onto the same vertex.

    Splits on the FIRST colon (label prefix) and slugifies the rest:
    lowercased, whitespace collapsed to single hyphens, stray
    punctuation removed. Internal colons in the value are preserved
    (e.g. Concept reification ids like ``c:Symptom:photophobia``).
    """
    if ":" not in vid:
        return vid
    label, _, value = vid.partition(":")
    import re

    slug = value.lower().strip()
    slug = re.sub(r"\s+", "-", slug)
    # Allow alnum, hyphen, underscore, AND colons (for nested ids).
    slug = re.sub(r"[^a-z0-9_:\-]", "", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return f"{label}:{slug}" if slug else label


def _materialize(
    tool_input: dict,
    *,
    current_headache_id: str | None,
    allowed_vertex_props: dict[str, set[str]],
    allowed_edges: dict[str, tuple[str, str]],
    allowed_edge_props: dict[str, set[str]],
    canonical_ids: dict[tuple[str, str], str] | None = None,
    singleton_ids: dict[str, str] | None = None,
) -> ExtractionResult:
    vertices_in = tool_input.get("vertices", []) or []
    edges_in = tool_input.get("edges", []) or []
    new_headache_id = tool_input.get("new_current_headache_id")
    signaled_done = bool(tool_input.get("patient_signaled_done", False))
    resumed = bool(tool_input.get("patient_resumed", False))
    schema_gaps = tuple(
        str(item).strip()
        for item in (tool_input.get("schema_gaps", []) or [])
        if str(item).strip()
    )

    out_vertices: dict = {}
    out_edges: dict = {}
    aliases: dict[str, str] = {}
    known_canonical = dict(canonical_ids or {})
    known_singletons = dict(singleton_ids or {})

    for v in vertices_in:
        label = v.get("label")
        vid = v.get("id")
        if not label or not vid:
            continue
        if label not in allowed_vertex_props:
            log.warning("Extractor: skipping vertex with unknown label %r", label)
            continue
        # Normalize the id so equivalent natural-language values collapse
        # to one vertex. The slug fix matters most for vocabulary types
        # (Quality, BodyLocation, Severity, ...) where the LLM emits
        # things like 'Quality:dull ache' vs 'Quality:dull-ache'.
        original_vid = _normalize_vertex_id(vid)
        props_in = v.get("properties") or {}
        allowed = allowed_vertex_props[label]
        properties: dict = {}
        for k, val in props_in.items():
            if k not in allowed:
                log.debug(
                    "Extractor: dropping property %r on %s (not in schema)",
                    k, label,
                )
                continue
            # NB: bool is a subclass of int, so check bool first.
            if isinstance(val, bool):
                properties[pg.PropertyKey(k)] = _lit_bool(val)
            elif isinstance(val, int):
                properties[pg.PropertyKey(k)] = _lit_int(val)
            elif isinstance(val, str):
                properties[pg.PropertyKey(k)] = _lit(val)
            else:
                # Coerce anything else to string. Keeps the graph writable
                # if the model emits an unexpected JSON shape.
                properties[pg.PropertyKey(k)] = _lit(str(val))
        identity = _identity_key(label, props_in)
        vid = known_singletons.get(label, original_vid)
        if identity is not None:
            vid = known_canonical.get(identity, vid)
            known_canonical.setdefault(identity, vid)
        if label in _SINGLETON_LABELS:
            known_singletons.setdefault(label, vid)
        aliases[original_vid] = vid
        vid_lit = _lit(vid)
        out_vertices[vid_lit] = pg.Vertex(
            label=pg.VertexLabel(label), id=vid_lit,
            properties=FrozenDict(properties),
        )

    for e in edges_in:
        label = e.get("label")
        out = e.get("out")
        in_ = e.get("in")
        if not label or not out or not in_:
            continue
        if label not in allowed_edges:
            log.warning("Extractor: skipping edge with unknown label %r", label)
            continue
        # Normalize endpoint ids the same way we normalize vertex ids so
        # edges land on the right vertex even if the LLM produced a
        # slightly different slug.
        out = aliases.get(_normalize_vertex_id(out), _normalize_vertex_id(out))
        in_ = aliases.get(_normalize_vertex_id(in_), _normalize_vertex_id(in_))
        # Defensive: if the model swapped out/in (Haiku sometimes reads
        # "triggers" as the trigger pointing at the headache), correct it.
        expected_out, expected_in = allowed_edges[label]
        out_v = out_vertices.get(_lit(out))
        in_v = out_vertices.get(_lit(in_))
        out_label = out_v.label.value if out_v else None
        in_label = in_v.label.value if in_v else None
        if (
            out_label == expected_in
            and in_label == expected_out
            and out_label != expected_out
        ):
            log.info("Extractor: flipping reversed edge %s", label)
            out, in_ = in_, out
        # Edge properties, filtered by what the schema declares for this
        # edge label.
        edge_props_in = e.get("properties") or {}
        allowed_edge = allowed_edge_props.get(label, set())
        edge_properties: dict = {}
        for k, val in edge_props_in.items():
            if k not in allowed_edge:
                log.debug(
                    "Extractor: dropping edge prop %r on %s (not in schema)",
                    k, label,
                )
                continue
            if isinstance(val, bool):
                edge_properties[pg.PropertyKey(k)] = _lit_bool(val)
            elif isinstance(val, int):
                edge_properties[pg.PropertyKey(k)] = _lit_int(val)
            elif isinstance(val, str):
                edge_properties[pg.PropertyKey(k)] = _lit(val)
            else:
                edge_properties[pg.PropertyKey(k)] = _lit(str(val))

        eid = f"{out}-{label}->{in_}"
        eid_lit = _lit(eid)
        out_edges[eid_lit] = pg.Edge(
            label=pg.EdgeLabel(label),
            id=eid_lit,
            out=_lit(out), in_=_lit(in_),
            properties=FrozenDict(edge_properties),
        )

    # Mint Headache uuid if the model didn't and the utterance produced a
    # Headache vertex without a current id. (Defensive: the system prompt
    # asks the model to do this, but we shouldn't trust it.)
    next_headache_id: str | None = current_headache_id
    if new_headache_id:
        normalized_headache_id = _normalize_vertex_id(new_headache_id)
        next_headache_id = aliases.get(normalized_headache_id, normalized_headache_id)
    elif any(v.label.value == "Headache" for v in out_vertices.values()):
        # The model emitted a Headache but didn't flag a new id. If exactly
        # one Headache vertex appears, treat its id as the current one.
        headaches = [
            v for v in out_vertices.values() if v.label.value == "Headache"
        ]
        if len(headaches) == 1:
            next_headache_id = headaches[0].id.value

    delta = pg.Graph(
        vertices=FrozenDict(out_vertices),
        edges=FrozenDict(out_edges),
    )
    return ExtractionResult(
        delta=delta,
        new_current_headache_id=next_headache_id,
        patient_signaled_done=signaled_done,
        patient_resumed=resumed,
        schema_gaps=schema_gaps,
    )


def _validate_domain_contract(
    delta: pg.Graph,
    edge_by_vertex: dict[str, str],
    domain_name: str,
) -> str | None:
    if not edge_by_vertex:
        return None
    edges = list(delta.edges.values())
    evidence_ids = {
        vertex.id.value
        for vertex in delta.vertices.values()
        if vertex.label.value == "ProvenanceEvidence"
    }
    episode_ids = {
        vertex.id.value
        for vertex in delta.vertices.values()
        if vertex.label.value == "TranscriptEpisode"
    }
    for vertex in delta.vertices.values():
        vertex_id = vertex.id.value
        if not re.fullmatch(r"[a-z0-9][a-z0-9:-]*[a-z0-9]", vertex_id):
            return f"vertex id {vertex_id!r} must use lowercase letters, digits, hyphens, and colons"
        if domain_name == "hospitality" and len(vertex_id) > 80:
            return f"hospitality vertex id {vertex_id!r} exceeds 80 characters"
        expected_prefix = _ID_PREFIX_BY_LABEL.get(vertex.label.value)
        if expected_prefix and not vertex_id.startswith(expected_prefix):
            return (
                f"{vertex.label.value} id {vertex_id!r} must start with "
                f"{expected_prefix!r}"
            )
        if vertex.label.value != "ProvenanceEvidence":
            continue
        source = vertex.properties.get(pg.PropertyKey("sourceEpisode"))
        source_id = getattr(source, "value", None)
        if source_id not in episode_ids:
            return (
                f"ProvenanceEvidence {vertex.id.value!r} must reference a "
                "TranscriptEpisode emitted in the same delta"
            )
        trace = vertex.properties.get(pg.PropertyKey("traceText"))
        trace_text = str(getattr(trace, "value", "")).strip().lower()
        banned = {
            "the expert mentioned",
            "the doctor said",
            "extracted from interview",
            "see transcript",
            "n/a",
            "not available",
            "unknown",
        }
        if domain_name == "hospitality":
            banned.update({
                "the expert described their approach",
                "the owner mentioned",
                "hospitality knowledge",
                "the expert talked about",
                "general hospitality principle",
            })
        if not trace_text or any(trace_text.startswith(item) for item in banned):
            return f"ProvenanceEvidence {vertex_id!r} has generic traceText"
        speaker = vertex.properties.get(pg.PropertyKey("speaker"))
        if getattr(speaker, "value", None) not in {"expert", "interviewer", "system"}:
            return f"ProvenanceEvidence {vertex_id!r} has invalid speaker"
        confidence = vertex.properties.get(pg.PropertyKey("confidence"))
        confidence_value = getattr(confidence, "value", None)
        if confidence_value is not None and confidence_value not in {
            "high", "medium", "low", "inferred"
        }:
            return f"ProvenanceEvidence {vertex_id!r} has invalid confidence"
        if confidence_value == "inferred" and trace_text.count("ep:") < 2:
            return (
                f"ProvenanceEvidence {vertex_id!r} uses inferred confidence "
                "without citing at least two episode ids"
            )
    for vertex in delta.vertices.values():
        expected = edge_by_vertex.get(vertex.label.value)
        if expected is None:
            continue
        attached = [
            edge for edge in edges
            if edge.out.value == vertex.id.value and edge.label.value == expected
        ]
        if not attached:
            return (
                f"{vertex.label.value} {vertex.id.value!r} requires provenance "
                f"edge {expected} in the same delta"
            )
        if any(edge.in_.value not in evidence_ids for edge in attached):
            return (
                f"{expected} from {vertex.id.value!r} must target a "
                "ProvenanceEvidence vertex emitted in the same delta"
            )
    delta_ids = {vertex.id.value for vertex in delta.vertices.values()}
    infrastructure_edges = {"hasSession", "hasSection", "hasEpisode"}
    provenance_edges = set(edge_by_vertex.values())
    for edge in edges:
        if edge.out.value == edge.in_.value:
            return f"edge {edge.label.value!r} must not reference itself"
        if (
            edge.label.value not in infrastructure_edges
            and edge.label.value not in provenance_edges
        ):
            for endpoint in (edge.out.value, edge.in_.value):
                if endpoint not in delta_ids:
                    return (
                        f"existing vertex {endpoint!r} is enriched by "
                        f"{edge.label.value!r} and must be re-emitted with "
                        "new provenance in this delta"
                    )
    evidence_keys: set[tuple[str, str]] = set()
    for vertex in delta.vertices.values():
        if vertex.label.value != "ProvenanceEvidence":
            continue
        source = vertex.properties.get(pg.PropertyKey("sourceEpisode"))
        trace = vertex.properties.get(pg.PropertyKey("traceText"))
        key = (
            str(getattr(source, "value", "")),
            str(getattr(trace, "value", "")).strip().lower(),
        )
        if key in evidence_keys:
            return f"duplicate provenance evidence for source {key[0]!r}"
        evidence_keys.add(key)
    if domain_name == "hospitality":
        for vertex in delta.vertices.values():
            props = vertex.properties
            if vertex.label.value == "DecisionRule":
                text = getattr(props.get(pg.PropertyKey("ruleText")), "value", "")
                if len(str(text).strip()) <= 20:
                    return f"DecisionRule {vertex.id.value!r} must have specific ruleText"
            if vertex.label.value == "OperatingHeuristic":
                text = getattr(props.get(pg.PropertyKey("heuristic")), "value", "")
                if len(str(text).strip()) <= 10:
                    return f"OperatingHeuristic {vertex.id.value!r} must have specific heuristic text"
    return None


def _validate_provenance_contract(
    delta: pg.Graph,
    edge_by_vertex: dict[str, str],
) -> str | None:
    """Backward-compatible test hook for the original provenance contract."""
    return _validate_domain_contract(delta, edge_by_vertex, "hypertension")


def synthesize_headache_id() -> str:
    """Mint a fresh Headache id. Exposed for tests/callers that pre-mint."""
    return f"Headache:{uuid.uuid4().hex[:12]}"

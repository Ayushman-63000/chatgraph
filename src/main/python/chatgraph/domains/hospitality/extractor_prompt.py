"""Extractor prompt for the hospitality expert-interview graph."""

EXTRACTOR_PROMPT_INTRO = """You extract a typed property-graph delta from a
hospitality business owner's latest expert-interview utterance.

Emit only knowledge stated or clearly implied by the expert. Never add generic
hospitality advice. Stories are evidence: extract the rule, heuristic, signal,
principle, action, or constraint embedded in the story; keep the specific story
language in ProvenanceEvidence.traceText rather than modeling the incident as a
separate graph.

Infrastructure:
- Person, KnowledgeSession, and the Introduction SessionSection exist at start.
- Emit one TranscriptEpisode per expert utterance with exact verbatimText and
  speaker="expert"; use the supplied episode_id.
- Connect it from the current SessionSection with hasEpisode.
- Infer the current section from the interviewer's latest question. Reuse an
  existing section id or emit the matching SessionSection, order 1 through 7.
- Never mint another Person or KnowledgeSession. Upsert their supplied ids only
  when the expert explicitly provides metadata.
- During Introduction emit only TranscriptEpisode and session metadata.

Knowledge mapping:
- GuestExperiencePrinciple: foundational belief about excellent hospitality.
- ServiceStandard: concrete enforced or non-negotiable service standard.
- GuestSignal: observable cue used to read satisfaction, value, or return intent.
- GuestPersona: practical guest category used in real operating decisions.
- CheckInPolicy and CheckOutPolicy: one singleton of each per session. Always
  reuse policy:checkin:{session_id} and policy:checkout:{session_id}.
- TimingRule: experience-refined arrival/departure if-then timing logic.
- ServiceFailure and RecoveryAction: failure category and proven recovery step.
- ExceptionRule: a stated override or flexibility rule.
- DecisionRule: explicit operational if-then logic.
- OperatingHeuristic: tacit rule of thumb or seasoned pattern.
- LoyaltyDriver and EmotionalMoment: what creates/destroys loyalty and the
  specific moment or gesture that does it.
- ContextualConstraint: seasonality, location, staffing, customer mix, or
  bottleneck modifying decisions or policies.
- Outcome: only a result explicitly connected to a rule, recovery, or loyalty
  action.

Reuse canonical ids across turns, especially GuestPersona, GuestSignal,
CheckInPolicy, and CheckOutPolicy. IDs are lowercase colon-namespaced slugs,
letters/digits/hyphens/colons only, at most 80 characters.

Provenance:
- Every knowledge vertex should have specific ProvenanceEvidence from the
  utterance. Reuse one evidence vertex for multiple vertices sharing one
  justification; split evidence when sub-statements differ.
- traceText is a verbatim quote or faithful, specific paraphrase; never a generic
  topic label. sourceEpisode is the emitted episode id; speaker="expert";
  confidence is high, medium, low, or inferred.
- inferred confidence is only for synthesis across at least two named episode
  ids in traceText.
- The canonical schema defines principleSupportedBy for
  GuestExperiencePrinciple, heuristicSupportedBy for OperatingHeuristic, and
  supportedBy for DecisionRule. Attach those exact edges. For other knowledge
  labels, emit the evidence vertex but do not invent a schema-invalid provenance
  edge; missing attachment is a soft review warning in the supplied rules.

Use only schema-declared labels and exact edge directions. No dangling or
self-referencing edges. Required properties shown with ! must be present and
JSON scalar types must match exactly. Prefer a sparse correct delta over
invented structure."""

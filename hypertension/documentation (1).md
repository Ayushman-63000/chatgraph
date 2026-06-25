## # Hypertension Domain — Hydra Graph Documentation

- **For human consumption only.**

- The single source of truth is `hypertension/hypertension schema.json`. If anything in this document

- conflicts with the JSON, the JSON wins.

---

## 1. Purpose

This document describes the property graph schema for the

**Hypertension** knowledge

domain in the Cognisee knowledge engineering system. The graph captures a senior

clinician's hypertension expertise — extracted via a structured 7-section interview —

and stores it as a queryable, provenance-traced property graph backed by a

Gremlin-compatible database.

The graph is built incrementally during a live expert session. Each conversational

turn produces a **delta** (a set of new vertices and edges) that is validated against

`hypertension/hypertension schema.json` and written to the graph before the next turn begins.

---

## 2. File Inventory

| File | Format | Purpose |

|------|--------|---------|

| `hypertension schema.json` | JSON | Hydra `GraphSchema` — single source of truth for all vertex/edge labels and property types |

- | `section map.json` | JSON | Maps the 7 interview sections to target vertex types, edge patterns, and extraction goals |

- | `provenance spec.json` | JSON | ProvenanceEvidence field

rules, attachment logic, confidence semantics, and ID conventions |

| `ingestion_config.json` | JSON | Runtime config for the conversational agent, LLM extractor, Gremlin writer, and validation pipeline |

- | `validation rules.json` | JSON | 15 validation rules (14 hard, 1 soft) enforced on every delta before write |

- | `Prompt Hypetension.txt` | TXT | Canonical human-readable 7-section prompt reference |
- | `Prompt Hypetension.docx` | DOCX | Export-only rendering; never loaded at runtime |

- | `documentation.md` | MD | This document |

---

## 3. Architecture Overview

### 5-Layer Graph Model

┌─────────────────────────────────────────────────────────────┐ │ LAYER 1 — SESSION │ │ Person · KnowledgeSession · SessionSection │ │ · TranscriptEpisode │ ├─────────────────────────────────────────────────────────────┤

│ LAYER 2 — CLINICAL FACTS │ │ HypertensionConcept · BloodPressureMeasurement │ │ DiagnosticCriterion · ClinicalFinding · Symptom │ │ Comorbidity · RiskFactor · SecondaryCause │ │ DiagnosticTest · Medication · LifestyleIntervention │ ├─────────────────────────────────────────────────────────────┤ │ LAYER 3 — REASONING │ │ DecisionRule · ClinicalReasoningPattern │ │ Pitfall · CaseScenario │

├─────────────────────────────────────────────────────────────┤ │ LAYER 4 — CONTEXT & OUTCOMES │ │ ContextualConstraint · FollowUpPlan · Outcome │ ├─────────────────────────────────────────────────────────────┤ │ LAYER 5 — PROVENANCE │ │ ProvenanceEvidence │ └─────────────────────────────────────────────────────────────┘

## ### High-Level Graph Shape

## Person

└── hasSession──► KnowledgeSession

└── hasSection──► SessionSection └── ──► hasEpisode TranscriptEpisode │ ┌─────────────────────┤ │ discusses  discussesRule│ │ discussesCase │ ▼▼ HypertensionConcept DecisionRule ││

┌─────────────┤┌───────┤

││││ classifiedAs requires triggers leadsTo ││││ ▼▼│▼ BloodPressure DiagnosticTest ClinicalFinding Outcome Measurement │ planMonitoredBy │

FollowUpPlan

HypertensionConcept ├──treatedWith──────────────► Medication │└──contraindicated──► Comorbidity

──────► │└──monitoredBy DiagnosticTest └── ────────► lifestyleTreatment LifestyleIntervention

ClinicalReasoningPattern

├──explainedBy──────────────► DecisionRule └── patternExplainsCase──────► CaseScenario

## Pitfall

└── avoid────────────────────► DecisionRule

ContextualConstraint

├──modulatedBy──────────────► DecisionRule └── constraintModulatesPlan──► FollowUpPlan

(every knowledge node)

└── supportedBy / conceptSupportedBy──► ProvenanceEvidence

---

## 4. Naming Conventions

## | Concept | Convention | Example |

|---------|-----------|---------|

- | Vertex label | PascalCase | `HypertensionConcept` |

- | Edge label | camelCase | `treatedWith` |

- | Property key | camelCase | `criterionName` |

- | Required property | `required: true` in schema | `ruleText` on `DecisionRule` |

- | Vertex ID | lowercase slug | `concept:stage-2-hypertension` |

- | Edge ID | lowercase slug | auto-generated or omitted |

---

## 5. Vertex Reference

### Layer 1 — Session

---

## #### `Person`

Represents the clinical expert being interviewed.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

| `name` | string | No | Full name of the expert |

**ID convention:** `person:{name_slug}`

**Example:** `person:dr-james-wilson`

---

#### `KnowledgeSession`

The root node of every session. Must be written first before any other vertex.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `domain` | string | **Yes** | Must be `"hypertension"` |

- | `expertName` | string | No | Name of the expert |

| `expertRole` | string | No | Clinical role/title |

| `date` | string | No | ISO-8601 date of session |

| `objective` | string | No | Stated purpose of the session |

| `confidentialityLevel` | string | No | e.g. `"internal"`, `"restricted"` |

**ID convention:** `session:hypertension:{UTC_COMPACT_TIMESTAMP}:{RANDOM8}` **Example:** `session:hypertension:20260618t015000000z:a1b2c3d4`

---

#### `SessionSection`

One of the 7 structured interview sections.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `sectionType` | string | **Yes** | Slug identifying the section type (e.g. `"explicit_clinical_knowledge"`) |

- | `order` | int32 | **Yes** | Section number 1–7 |

- | `title` | string | No | Human-readable section title |

- | `purpose` | string | No | What this section aims to extract |

**ID convention:** `section:{session_id}:{order}` **Example:** `section:session:hypertension:20260618t015000000z:a1b2c3d4:2`

---

#### `TranscriptEpisode`

A single conversational utterance from the session transcript.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `verbatimText` | string | **Yes** | The full text of the utterance |

- | `speaker` | string | No | `"expert"`, `"interviewer"`, or `"system"` |

- | `startTime` | string | No | Relative or ISO offset within session |

- | `endTime` | string | No | Relative or ISO offset within session |

- | `confidence` | string | No | Transcription confidence if ASR was used |

**ID convention:** `ep:{session_id}:{sequence}` **Example:** `ep:session:hypertension:20260618t015000000z:a1b2c3d4:7`

---

### Layer 2 — Clinical Facts

---

#### `HypertensionConcept`

A named hypertension-related clinical concept: a classification, syndrome, condition, or guideline category.

| Property | Type | Required | Description | |----------|------|----------|-------------| | `name` | string | **Yes** | Canonical name (e.g. `"Stage 2 Hypertension"`) |

- | `definition` | string | No | Expert's working definition |

| `type` | string | No | e.g. `"classification"`, `"syndrome"`, `"guideline_category"` |

**ID convention:** `concept:{name_slug}` **Example:** `concept:stage-2-hypertension`

---

#### `BloodPressureMeasurement`

A specific BP reading, either mentioned in a case or used to define a threshold.

| Property | Type | Required | Description |

|----------|------|----------|-------------| | `systolic` | int32 | No | Systolic value in mmHg (e.g. `140`) | | `diastolic` | int32 | No | Diastolic value in mmHg (e.g. `90`) | | `unit` | string | No | Always `"mmHg"` | | `measurementContext` | string | No | e.g. `"clinic"`, `"home"`, `"ambulatory"` |

| `bodyPosition` | string | No | e.g. `"seated"`, `"supine"` |

| `armUsed` | string | No | `"left"`, `"right"`, `"both"` |

| `repeatReadings` | boolean | No | `true` if averaged over multiple readings |

**ID convention:** `bp:{context_slug}:{sequence}`

**Example:** `bp:clinic:01`

---

#### `DiagnosticCriterion`

A threshold, rule, or condition used to diagnose or classify hypertension, sourced from a guideline.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `criterionName` | string | **Yes** | Name of the criterion

- (e.g. `"ACC/AHA Stage 1 Threshold"`) |

- `| `threshold` | string | No | The actual threshold value (e.g. `"≥130/80 mmHg"`) |`

- | `conditions` | string | No | Qualifying conditions for this criterion |

- | `sourceGuideline` | string | No | e.g. `"ACC/AHA 2017"`, `"ESC 2023"`, `"JNC 8"` |

- | `notes` | string | No | Expert commentary on guideline differences |

**ID convention:** `criterion:{name_slug}` **Example:** `criterion:acc-aha-stage-1-threshold`

---

#### `ClinicalFinding`

An exam finding, investigation result, or clinical observation relevant to hypertension diagnosis or management.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

| `name` | string | **Yes** | Name of the finding (e.g. `"Papilledema"`) |

| `category` | string | No | e.g. `"fundoscopy"`, `"cardiovascular_exam"`, `"lab"` |

- | `interpretation` | string | No | What this finding means clinically |

- | `severity` | string | No | e.g. `"mild"`, `"moderate"`, `"severe"` |

- | `redFlag` | boolean | No | `true` if this finding requires urgent action |

**ID convention:** `finding:{name_slug}`

**Example:** `finding:papilledema`

---

#### `Symptom`

A symptom the patient reports that is relevant to hypertension or its secondary causes.

| Property | Type | Required | Description |

|----------|------|----------|-------------| | `name` | string | **Yes** | Symptom name (e.g. `"Episodic Headache"`) |

- | `onset` | string | No | Onset pattern (e.g. `"sudden"`, `"gradual"`) |

- | `duration` | string | No | Typical duration |

- | `clinicalSignificance` | string | No | Why this symptom matters in hypertension |

**ID convention:** `symptom:{name_slug}`

**Example:** `symptom:episodic-headache`

---

## #### `Comorbidity`

A concurrent condition that modifies hypertension management decisions.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `name` | string | **Yes** | Condition name (e.g. `"Type 2 Diabetes Mellitus"`) |

- | `impactOnManagement` | string | No | How this condition changes the treatment approach |

**ID convention:** `comorbidity:{name_slug}`

**Example:** `comorbidity:type-2-diabetes-mellitus`

---

#### `RiskFactor`

A cardiovascular or hypertension risk factor mentioned by the expert.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `name` | string | **Yes** | Risk factor name (e.g. `"Smoking"`) |

- | `modifiable` | boolean | No | `true` if the patient can change this factor |

- | `importanceLevel` | string | No | e.g. `"high"`, `"moderate"`, `"low"` |

**ID convention:** `riskfactor:{name_slug}`

**Example:** `riskfactor:smoking`

---

## #### `SecondaryCause`

A secondary cause of hypertension (non-essential hypertension) identified or screened for by the expert.

- | Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `name` | string | **Yes** | Cause name (e.g. `"Primary Aldosteronism"`) |

- | `type` | string | No | e.g. `"renal"`, `"endocrine"`, `"vascular"` |

- | `supportingClues` | string | No | Clinical features that suggest this cause |

- | `confirmatoryTests` | string | No | Tests used to confirm the diagnosis |

**ID convention:** `secondary:{name_slug}`

**Example:** `secondary:primary-aldosteronism`

---

#### `DiagnosticTest`

A test or investigation ordered in the context of hypertension diagnosis, secondary cause screening, or medication monitoring.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `testName` | string | **Yes** | Test name (e.g. `"24-Hour Ambulatory BP Monitoring"`) |

- | `indication` | string | No | When this test is ordered |

- | `expectedFindings` | string | No | What the expert expects to find |

- | `interpretation` | string | No | How the expert interprets results |

**ID convention:** `test:{name_slug}`

**Example:** `test:24-hour-ambulatory-bp-monitoring`

---

## #### `Medication`

An antihypertensive drug or drug class used in management.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `name` | string | **Yes** | Drug or class name (e.g. `"Amlodipine"`, `"ACE Inhibitor"`) |

- | `drugClass` | string | No | Pharmacological class (e.g. `"CCB"`, `"ARB"`, `"thiazide"`) |

- | `indication` | string | No | When this drug is preferred |

- | `contraindication` | string | No | When this drug must be avoided |

- | `sideEffects` | string | No | Notable side effects mentioned by expert |

- | `monitoringNeeded` | string | No | What to monitor after starting this drug |

**ID convention:** `med:{name_slug}`

**Example:** `med:amlodipine`

---

#### `LifestyleIntervention`

A non-pharmacological intervention for hypertension management.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `name` | string | **Yes** | Intervention name (e.g. `"DASH Diet"`) |

| `targetBehavior` | string | No | The specific behaviour being changed |

- | `expectedEffect` | string | No | Expected BP reduction or clinical effect |

- | `practicalConstraints` | string | No | Real-world barriers to implementation |

**ID convention:** `lifestyle:{name_slug}`

**Example:** `lifestyle:dash-diet`

---

### Layer 3 — Reasoning

---

#### `DecisionRule`

An explicit if-then rule governing a clinical management decision. The primary reasoning unit of the graph.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `ruleText` | string | **Yes** | The full rule as a natural language statement |

- | `ifCondition` | string | No | The condition that triggers this rule |

- | `thenAction` | string | No | The action taken when the condition is met |

- | `exception` | string | No | Conditions under which this rule does not apply |

- | `priority` | string | No | `"urgent"`, `"routine"`, `"elective"` |

**ID convention:** `rule:{if_condition_slug}`

**Example:** `rule:two-drug-failure-at-140-90`

---

#### `ClinicalReasoningPattern`

A heuristic, gut-feeling rule, or pattern recognition strategy the expert uses — tacit knowledge not found in textbooks.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `patternName` | string | **Yes** | Short name for the pattern |

- | `heuristic` | string | No | The heuristic in the expert's own words |

- | `whenUsed` | string | No | Clinical situations where this pattern applies |

- | `whyItMatters` | string | No | Why this pattern improves outcomes |

**ID convention:** `pattern:{name_slug}` **Example:** `pattern:young-patient-resistant-hypertension-always-screen-secondary`

---

#### `Pitfall`

A common error, trap, or mistake — made by residents, generalists, or even specialists — in hypertension management.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `description` | string | **Yes** | Description of the pitfall |

- | `commonMistake` | string | No | The specific mistake that leads to this pitfall |

| `howToAvoid` | string | No | The expert's recommended approach to avoid it |

**ID convention:** `pitfall:{description_slug}` **Example:** `pitfall:treating-white-coat-hypertension-with-medication`

---

#### `CaseScenario`

A clinical case — either a memorable real case or a structured scenario — used to illustrate reasoning.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `scenarioType` | string | **Yes** | Type slug (e.g.

- `"resistant_hypertension"`, `"hypertensive_emergency"`) |

- | `patientContext` | string | No | Brief patient description |

- | `problemStatement` | string | No | The clinical challenge in the case |

- | `expertReasoning` | string | No | How the expert reasoned through the case |

- | `finalDecision` | string | No | The management decision or outcome |

**ID convention:** `case:{scenario_type_slug}:{sequence}` **Example:** `case:hypertensive-emergency:01`

---

### Layer 4 — Context & Outcomes

---

#### `ContextualConstraint`

A real-world factor — resource limitation, patient preference, psychosocial barrier, or system constraint — that modifies a decision rule or follow-up plan.

- | Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `resourceLevel` | string | No | e.g. `"low-resource"`, `"tertiary-centre"` |

- | `patientPreference` | string | No | A stated patient preference affecting care |

- | `accessBarrier` | string | No | e.g. `"no pharmacy within 50km"` |

- | `systemConstraint` | string | No | e.g. `"no specialist referral available"` |

**ID convention:** `constraint:{context_slug}:{sequence}` **Example:** `constraint:low-resource-rural:01`

---

#### `FollowUpPlan`

A follow-up and monitoring plan associated with a hypertension concept or decision.

- | Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `interval` | string | No | Follow-up interval (e.g. `"4 weeks"`, `"3 months"`) |

- | `monitoringItems` | string | No | What to check at each visit |

- | `escalationTrigger` | string | No | Finding that would trigger plan escalation |

- | `reviewPoints` | string | No | Milestones where the plan is formally reviewed |

**ID convention:** `followup:{context_slug}:{sequence}` **Example:** `followup:stage-1-newly-diagnosed:01`

---

#### `Outcome`

A clinical outcome — the result of applying a decision rule or completing a management plan.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `outcomeType` | string | No | e.g. `"bp_controlled"`,

`"adverse_event"`, `"hospitalization"` |

- | `targetBp` | string | No | Target BP the outcome was measured against (e.g. `"<130/80"`) |

- | `achieved` | boolean | No | `true` if the target was reached |

- | `adverseEvent` | string | No | Description of any adverse event |

- | `hospitalization` | boolean | No | `true` if the outcome involved hospitalization |

- | `followupResult` | string | No | Summary of what happened at follow-up |

**ID convention:** `outcome:{context_slug}:{sequence}` **Example:** `outcome:resistant-hypertension:01`

---

### Layer 5 — Provenance

---

#### `ProvenanceEvidence`

Traces every extracted knowledge node back to the specific transcript utterance that justified its extraction. Every

knowledge vertex must have its label-specific provenance edge pointing to a ProvenanceEvidence node.

| Property | Type | Required | Description |

- |----------|------|----------|-------------|

- | `traceText` | string | **Yes** | Verbatim quote or faithful paraphrase from the transcript |

- | `sourceEpisode` | string | **Yes** | ID of the TranscriptEpisode this was extracted from |

- | `speaker` | string | **Yes** | `"expert"`, `"interviewer"`, or `"system"` |

| `timestamp` | string | No | Time offset within the session |

| `confidence` | string | No | `"high"`, `"medium"`, `"low"`, or `"inferred"` |

**ID convention:** `prov:{episode_id}:{sequence}` **Example:** `prov:ep:session:hypertension:20260618t015000000z:a1b2c3d4:7:01`

---

## 6. Edge Reference

### Session Edges

```
| Edge | Out → In | Meaning |
```

|------|----------|---------|

- `| `hasSession` | Person → KnowledgeSession | Links the expert to their session |`

- `| `hasSection` | KnowledgeSession → SessionSection | Session contains ordered sections |`

- `| `hasEpisode` | SessionSection → TranscriptEpisode | Section contains transcript utterances |`

```
### Transcript ↔ Knowledge Edges
```

```
| Edge | Out → In | Meaning |
```

|------|----------|---------|

- `| `discusses` | TranscriptEpisode → HypertensionConcept | Episode references a clinical concept |`

- `| `mentionedIn` | HypertensionConcept → TranscriptEpisode | Reverse link from concept to episode |`

- `| `discussesRule` | TranscriptEpisode → DecisionRule | Episode references a decision rule |`

- `| `discussesCase` | TranscriptEpisode → CaseScenario | Episode references a case scenario |`

## ### Clinical Facts Edges

- `| Edge | Out → In | Meaning |`

- |------|----------|---------|

- `| `classifiedAs` | BloodPressureMeasurement → HypertensionConcept | A BP reading maps to a classification |`

- `| `hasMeasurement` | CaseScenario → BloodPressureMeasurement | A case includes a specific BP reading |`

- `| `suggests` | ClinicalFinding → SecondaryCause | A finding points toward a secondary cause |`

- `| `symptomSuggests` | Symptom → SecondaryCause | A symptom points toward a secondary cause |`

- `| `requires` | HypertensionConcept → DiagnosticTest | A concept requires a specific test |`

- `| `requiresPlan` | HypertensionConcept → FollowUpPlan | A concept requires a follow-up plan |`

- `| `treatedWith` | HypertensionConcept → Medication | A concept is treated with a medication |`

- `| `caseTreatedWith` | CaseScenario → Medication | A case was treated with a medication |`

- `| `lifestyleTreatment` | HypertensionConcept → LifestyleIntervention`

- `| A concept is managed via lifestyle change |`

```
| `contraindicated` | Medication → Comorbidity | A drug is
contraindicated with a condition |
```

- `| `monitoredBy` | Medication → DiagnosticTest | A drug requires a monitoring test |`

```
| `planMonitoredBy` | FollowUpPlan → DiagnosticTest | A follow-up
plan requires a monitoring test |
```

## ### Reasoning Edges

```
| Edge | Out → In | Meaning |
```

|------|----------|---------|

- `| `triggers` | ClinicalFinding → DecisionRule | A finding activates a decision rule |`

- `| `leadsTo` | DecisionRule → Outcome | A rule application produces an outcome |`

- `| `explainedBy` | ClinicalReasoningPattern → DecisionRule | A pattern explains why a rule works |`

- `| `patternExplainsCase` | ClinicalReasoningPattern → CaseScenario | A pattern explains reasoning in a case |`

```
| `avoid` | Pitfall → DecisionRule | A pitfall is related to
misapplication of a rule |
```

## ### Context Edges

```
| Edge | Out → In | Meaning |
```

|------|----------|---------|

- `| `modulatedBy` | ContextualConstraint → DecisionRule | A context factor modifies a rule |`

- `| `constraintModulatesPlan` | ContextualConstraint → FollowUpPlan | A context factor modifies a follow-up plan |`

### Provenance Edges

```
| Edge | Out → In | Meaning |
```

|------|----------|---------|

- `| `supportedBy` | DecisionRule → ProvenanceEvidence | Traces a decision rule to its transcript source |`

- `| `conceptSupportedBy` | HypertensionConcept → ProvenanceEvidence | Specific provenance edge for concept vertices |`
- `| `*SupportedBy` | Matching knowledge vertex → ProvenanceEvidence | Dedicated typed provenance edges for all other knowledge labels; see provenance spec.json |`

---

## 7. Extraction Rules

1. **Required properties must always be present.** Missing required fields cause delta rejection and LLM extractor retry (up to 3 attempts).

2. **Literal types are strict.** `int32` fields (e.g. `systolic`, `diastolic`, `order`) must be bare JSON integers — not strings, not floats. `boolean` fields must be `true` or

- `false` — not `"true"`, not `1`.

3. **No invented labels.** Only vertex and edge labels declared in `hypertension schema.json` are valid. Any unknown label causes immediate delta rejection.

4. **No dangling edges.** Every edge endpoint must exist either in the current delta or in the vertex ID cache from prior turns.

5. **Reuse vertex IDs across turns.** If the same concept is mentioned in Section C that was first extracted in Section B, add new edges to the existing vertex — never emit a duplicate vertex.

6. **Provenance on every knowledge node.** Every Layer 2–4 vertex must have its label-specific provenance edge to a `ProvenanceEvidence` node in the same delta.

7. **One delta per turn.** The extractor emits one delta per expert utterance. Do not batch multiple turns.

8. **KnowledgeSession must be written first.** No other vertex can be written until the `KnowledgeSession` root exists in the graph.

---

## ## 8. ID Conventions Quick Reference

| Vertex | Pattern | Example | |--------|---------|---------|

- | `Person` | `person:{name_slug}` | `person:dr-james-wilson` |

- | `KnowledgeSession` | `session:hypertension:{UTC_COMPACT_TIMESTAMP}:{RANDOM8}` |

`session:hypertension:20260618t015000000z:a1b2c3d4` |

- | `SessionSection` | `section:{session_id}:{order}` |

`section:session:hypertension:20260618t015000000z:a1b2c3d4:2` |

- | `TranscriptEpisode` | `ep:{session_id}:{sequence}` |

`ep:session:hypertension:20260618t015000000z:a1b2c3d4:7` |

- | `HypertensionConcept` | `concept:{name_slug}` |

`concept:stage-2-hypertension` |

- | `BloodPressureMeasurement` | `bp:{context_slug}:{sequence}` | `bp:clinic:01` |

- | `DiagnosticCriterion` | `criterion:{name_slug}` |

`criterion:acc-aha-stage-1` |

- | `ClinicalFinding` | `finding:{name_slug}` |

`finding:papilledema` |

- | `Symptom` | `symptom:{name_slug}` | `symptom:episodicheadache` |

- | `Comorbidity` | `comorbidity:{name_slug}` |

`comorbidity:type-2-diabetes-mellitus` |

- | `RiskFactor` | `riskfactor:{name_slug}` | `riskfactor:smoking` | | `SecondaryCause` | `secondary:{name_slug}` | `secondary:primary-aldosteronism` |

- | `DiagnosticTest` | `test:{name_slug}` | `test:24-hourambulatory-bp-monitoring` |

- | `Medication` | `med:{name_slug}` | `med:amlodipine` |

- | `LifestyleIntervention` | `lifestyle:{name_slug}` |

`lifestyle:dash-diet` |

- | `FollowUpPlan` | `followup:{context_slug}:{sequence}` | `followup:stage-1-newly-diagnosed:01` |

- | `DecisionRule` | `rule:{if_condition_slug}` | `rule:two-drugfailure-at-140-90` |

- | `ClinicalReasoningPattern` | `pattern:{name_slug}` |

- `pattern:young-resistant-screen-secondary` |

- | `Pitfall` | `pitfall:{description_slug}` | `pitfall:whitecoat-overtreatment` |

- | `CaseScenario` | `case:{scenario_type}:{sequence}` |

- `case:hypertensive-emergency:01` |

- | `ContextualConstraint` | `constraint:{context_slug}:{sequence}

- ` | `constraint:low-resource-rural:01` |

- | `Outcome` | `outcome:{context_slug}:{sequence}` |

`outcome:resistant-hypertension:01` |

- | `ProvenanceEvidence` | `prov:{episode_id}:{sequence}` |

- `prov:ep:session:hypertension:20260618t015000000z:a1b2c3d4:7:01` |

---

## 9. Section-to-Graph Mapping Summary

| Section | Type | Primary Vertices Written |

|---------|------|--------------------------|

| A — Introduction | `introduction` | Person, KnowledgeSession, SessionSection, TranscriptEpisode |

- | B — Explicit Clinical Knowledge |

`explicit_clinical_knowledge` | HypertensionConcept,

BloodPressureMeasurement, DiagnosticCriterion, ClinicalFinding, Symptom, Comorbidity, RiskFactor |

- | C — Clinical Processes & Workflows |

`clinical_processes_workflows` | DecisionRule, DiagnosticTest, Medication, LifestyleIntervention, FollowUpPlan, SecondaryCause |

| D — Experience-Based Insights | `experience_based_insights` | ClinicalReasoningPattern, Pitfall, CaseScenario |

| E — Case-Based Reasoning | `case_based_reasoning` | CaseScenario, BloodPressureMeasurement, Outcome (enriches existing vertices) |

| F — Rules & Decision Criteria |

`rules_guidelines_decision_criteria` | DecisionRule,

DiagnosticCriterion, Outcome (enriches existing vertices) |

| G — Contextual & Systemic Factors |

`contextual_systemic_factors` | ContextualConstraint (enriches existing DecisionRule and FollowUpPlan vertices) |

---

*Cognisee — Hypertension Knowledge Graph | June 2026*

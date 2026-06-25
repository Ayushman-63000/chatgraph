# Expert-domain implementation traceability

This manifest maps the Hypertension and Hospitality folder contracts to executable
behavior. Schema JSON and canonical TXT prompts have precedence over prose and
export-only DOCX files.

| Contract requirement | Implementation evidence | Behavioral evidence |
|---|---|---|
| Exact A–G question order | `config/expert-interviews.json`, Python and TypeScript interview controllers | `test_interview_controller.py`, `interview.test.mjs` |
| One question per turn | Deterministic controllers return one catalog question or one probe | Full catalog traversal tests |
| Sufficiency, probing, filler retention | Controller answer assessment and probe state | Filler/probe tests |
| Deep-dive offer and explicit transition | Shared exact transition strings and controller phases | Deep-dive transition tests |
| Canonical closure | Domain closing lines in the shared catalog | Full-session traversal tests |
| Safety and prohibited topics | Domain system prompts and canonical catalogs | Prompt contract tests |
| Session roots and seven sections | Root initialization and section infrastructure writers | Domain and section-state tests |
| Exact transcript episodes | Server-created expert/interviewer episodes in both runtimes | Extraction and resume contract tests |
| Active-section extraction scope | Section labels, edges, goals and instructions passed to extractors | Cross-file section-map tests |
| Strict schema allowlists | Schema-derived tools, materializers and sanitizers | Schema-isolation tests |
| Required properties and scalar types | Hydra delta validation and TypeScript schema sanitizer | Invalid-delta tests |
| Canonical IDs and prefixes | Shared label-prefix validation, slug validation and sequence generation | Contract tests |
| Canonical vertex reuse | Normalized identity caches in Python and web | Reuse contract tests |
| Hospitality policy singletons | Canonical singleton IDs and cache rewriting | Singleton/session-close tests |
| Idempotent edges | Deterministic `(out,label,in)` edge IDs | Replay and merge tests |
| Typed provenance for every knowledge vertex | Provenance mapping validation in both runtimes | Provenance schema tests |
| Specific trace text and enumerations | Banned-text, speaker and confidence validators | Invalid provenance tests |
| Shared/split/inferred provenance | Extractor instructions plus duplicate and multi-episode checks | Provenance behavior tests |
| Cross-section enrichment evidence | Existing endpoints must be re-emitted with current provenance | Invalid enrichment tests |
| Hospitality tacit story extraction | Hospitality extractor guidance for stories, counterfactuals, negation and comparison | Golden anecdote fixtures |
| `SCHEMA_GAP` handling | Extractor tool field and session warning/audit output | Schema-gap tests |
| Three correction attempts | Python and web extraction retry loops | Invalid-delta retry tests |
| Hypertension R001–R015 | Hydra/schema validation plus domain contract checks and BP audit | Hypertension contract tests |
| Hospitality HR001–HR015 | Delta sanitizer/domain contract validation | Hospitality contract tests |
| Hospitality HR016–HR025 | Full-session validators in Python and TypeScript | Session-close validation tests |
| Transactional serialized writes | Extraction lock and transactional Gremlin queue | Writer contract tests |
| Connection retries | Gremlin three-attempt connect/write recovery | Writer failure tests |
| Resume reconstruction | Graph cache rebuild and transcript replay into interview state | Resume tests |
| Cross-runtime parity | Shared catalog and equivalent validation semantics | Common transcript fixtures |
| DOCX consistency | `bin/build_prompt_docx.py` regenerates exports from canonical TXT | Artifact consistency tests |

Completion means every row above has executable implementation and passing
behavioral evidence; comments or file-presence assertions alone are insufficient.

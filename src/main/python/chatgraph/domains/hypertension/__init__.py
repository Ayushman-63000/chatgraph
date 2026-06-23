"""Senior-clinician hypertension knowledge-elicitation domain."""

from pathlib import Path

from chatgraph.domains import Domain, register
from chatgraph.domains.hypertension import agent_prompt, extractor_prompt
from chatgraph.domains.hypertension.agent_prompt import (
    OPENING_LINE,
    SYSTEM_PROMPT as AGENT_SYSTEM_PROMPT,
)
from chatgraph.domains.hypertension.extractor_prompt import EXTRACTOR_PROMPT_INTRO


_SCHEMA_PATH = (
    Path(__file__).resolve().parents[6]
    / "hypertension"
    / "hypertension schema.json"
)
_SOURCE_DIR = Path(__file__).resolve().parents[6] / "hypertension"


DOMAIN = Domain(
    name="hypertension",
    display_label="hypertension",
    schema_path=_SCHEMA_PATH,
    conversation_prompt_path=Path(agent_prompt.__file__).resolve(),
    extractor_prompt_path=Path(extractor_prompt.__file__).resolve(),
    section_map_path=_SOURCE_DIR / "section map.json",
    provenance_spec_path=_SOURCE_DIR / "provenance spec.json",
    validation_rules_path=_SOURCE_DIR / "validation rules.json",
    agent_system_prompt=AGENT_SYSTEM_PROMPT,
    extractor_prompt_intro=EXTRACTOR_PROMPT_INTRO,
    opening_line=OPENING_LINE,
    description=(
        "Structured seven-part interview that captures a senior clinician's "
        "explicit and tacit hypertension expertise with provenance."
    ),
    participant_label="expert",
    session_infrastructure=True,
    person_id="person:expert",
    person_name="Hypertension expert",
    session_objective="Capture senior-clinician hypertension expertise",
    resume_opening=(
        "Welcome back, Doctor. What would you like to add or refine in the "
        "hypertension knowledge base?"
    ),
    id_convention="lowercase colon-namespaced slugs",
)


register(DOMAIN)

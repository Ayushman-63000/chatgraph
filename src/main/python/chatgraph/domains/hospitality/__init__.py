"""Senior hospitality-owner knowledge-elicitation domain."""

from pathlib import Path

from chatgraph.domains import Domain, register
from chatgraph.domains.hospitality import agent_prompt, extractor_prompt
from chatgraph.domains.hospitality.agent_prompt import (
    OPENING_LINE,
    SYSTEM_PROMPT as AGENT_SYSTEM_PROMPT,
)
from chatgraph.domains.hospitality.extractor_prompt import EXTRACTOR_PROMPT_INTRO


_SCHEMA_PATH = (
    Path(__file__).resolve().parents[6]
    / "src"
    / "main"
    / "json"
    / "hospitality.json"
)
_SOURCE_DIR = Path(__file__).resolve().parents[6] / "hospitality"


DOMAIN = Domain(
    name="hospitality",
    display_label="hospitality",
    schema_path=_SCHEMA_PATH,
    conversation_prompt_path=Path(agent_prompt.__file__).resolve(),
    extractor_prompt_path=Path(extractor_prompt.__file__).resolve(),
    section_map_path=_SOURCE_DIR / "section map.json",
    validation_rules_path=_SOURCE_DIR / "validation rules.json",
    agent_system_prompt=AGENT_SYSTEM_PROMPT,
    extractor_prompt_intro=EXTRACTOR_PROMPT_INTRO,
    opening_line=OPENING_LINE,
    description=(
        "Structured seven-part interview capturing a hospitality owner's "
        "guest-experience principles, operating rules, recovery playbooks, "
        "loyalty drivers, constraints, and tacit expertise."
    ),
    participant_label="expert",
    session_infrastructure=True,
    person_id="person:expert",
    person_name="Hospitality expert",
    session_objective="Capture hospitality operating expertise",
    resume_opening=(
        "Welcome back. What would you like to add or refine in the hospitality "
        "knowledge base?"
    ),
    id_convention="lowercase colon-namespaced slugs, maximum 80 characters",
)


register(DOMAIN)

"""Senior hospitality-owner knowledge-elicitation domain."""

from pathlib import Path

from chatgraph.domains import Domain, register
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


DOMAIN = Domain(
    name="hospitality",
    schema_path=_SCHEMA_PATH,
    agent_system_prompt=AGENT_SYSTEM_PROMPT,
    extractor_prompt_intro=EXTRACTOR_PROMPT_INTRO,
    opening_line=OPENING_LINE,
    description=(
        "Structured seven-part interview capturing a hospitality owner's "
        "guest-experience principles, operating rules, recovery playbooks, "
        "loyalty drivers, constraints, and tacit expertise."
    ),
)


register(DOMAIN)

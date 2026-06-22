"""Senior-clinician hypertension knowledge-elicitation domain."""

from pathlib import Path

from chatgraph.domains import Domain, register
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


DOMAIN = Domain(
    name="hypertension",
    schema_path=_SCHEMA_PATH,
    agent_system_prompt=AGENT_SYSTEM_PROMPT,
    extractor_prompt_intro=EXTRACTOR_PROMPT_INTRO,
    opening_line=OPENING_LINE,
    description=(
        "Structured seven-part interview that captures a senior clinician's "
        "explicit and tacit hypertension expertise with provenance."
    ),
)


register(DOMAIN)

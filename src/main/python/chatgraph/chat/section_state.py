"""Deterministic seven-section transition rules."""

from __future__ import annotations

import re


DEEP_DIVE_QUESTION = (
    "Before we move on, would you like to go deeper into anything from this section?"
)
MOVE_NEXT_QUESTION = "Is it okay to move to the next question?"


def next_section_order(
    current: int,
    section_count: int,
    previous_agent: str,
    expert_answer: str,
) -> int:
    answer = re.sub(r"[^a-z0-9\s]", " ", expert_answer.lower())
    answer = re.sub(r"\s+", " ", answer).strip()
    negative = re.match(
        r"^(no|nope|nothing|not really|that is all|thats all|move on|next)(\b|$)",
        answer,
    )
    affirmative = re.match(
        r"^(yes|yeah|yep|sure|okay|ok|please do|move on|next)(\b|$)",
        answer,
    )
    advance = (
        DEEP_DIVE_QUESTION in previous_agent and negative is not None
    ) or (
        MOVE_NEXT_QUESTION in previous_agent and affirmative is not None
    )
    return min(section_count, current + 1) if advance else current

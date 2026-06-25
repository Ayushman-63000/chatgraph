"""Deterministic controller for the two seven-section expert interviews."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, replace
from pathlib import Path


DEEP_DIVE_QUESTION = (
    "Before we move on, would you like to go deeper into anything from this section?"
)
MOVE_NEXT_QUESTION = "Is it okay to move to the next question?"

_ROOT = Path(__file__).resolve().parents[5]
_CONTRACTS = json.loads(
    (_ROOT / "config" / "expert-interviews.json").read_text(encoding="utf-8")
)


@dataclass(frozen=True)
class InterviewState:
    section_order: int = 1
    question_index: int = 0
    phase: str = "question"
    awaiting_answer: bool = True
    probe_count: int = 0
    deep_dive_topic: str | None = None
    deep_dive_turns: int = 0


@dataclass(frozen=True)
class InterviewResult:
    reply: str
    state: InterviewState
    assessment: str


def is_expert_domain(domain_name: str) -> bool:
    return domain_name in _CONTRACTS


def opening_line(domain_name: str) -> str:
    return _CONTRACTS[domain_name]["openingLine"]


def current_question(domain_name: str, state: InterviewState) -> str:
    section = _CONTRACTS[domain_name]["sections"][state.section_order - 1]
    return section["questions"][state.question_index]


def current_question_minimum_words(
    domain_name: str,
    state: InterviewState,
) -> int:
    section = _CONTRACTS[domain_name]["sections"][state.section_order - 1]
    minimums = section.get("minimumWords", [])
    if state.question_index < len(minimums):
        return int(minimums[state.question_index])
    return 3


def preview_reply(domain_name: str, state: InterviewState) -> str:
    contract = _CONTRACTS[domain_name]
    if state.phase in {"closure", "complete"}:
        return contract["closingLine"]
    if state.phase == "deep_dive_offer":
        return DEEP_DIVE_QUESTION
    if state.phase == "deep_dive_topic":
        return "Which topic from this section would you like to explore more deeply?"
    if state.phase == "deep_dive":
        if state.deep_dive_turns == 0:
            topic = state.deep_dive_topic or "that topic"
            return (
                "What is the most important reasoning, exception, or example "
                f"behind {topic}?"
            )
        return MOVE_NEXT_QUESTION
    if state.phase == "transition":
        return MOVE_NEXT_QUESTION
    return current_question(domain_name, state)


def advance(
    domain_name: str,
    state: InterviewState,
    answer: str,
) -> InterviewResult:
    contract = _CONTRACTS[domain_name]
    if not state.awaiting_answer:
        next_state = replace(state, awaiting_answer=True)
        return InterviewResult(preview_reply(domain_name, next_state), next_state, "sufficient")

    if state.phase in {"closure", "complete"}:
        next_state = replace(state, phase="complete")
        return InterviewResult(contract["closingLine"], next_state, "sufficient")

    if state.phase == "deep_dive_offer":
        if _is_negative(answer):
            return _next_section_or_close(domain_name, state)
        next_state = replace(state, phase="deep_dive_topic")
        return InterviewResult(preview_reply(domain_name, next_state), next_state, "sufficient")

    if state.phase == "deep_dive_topic":
        if _is_filler(answer):
            return InterviewResult(
                "Which specific topic would you like to explore more deeply?",
                state,
                "filler",
            )
        next_state = replace(
            state,
            phase="deep_dive",
            deep_dive_topic=answer.strip(),
            deep_dive_turns=0,
        )
        return InterviewResult(preview_reply(domain_name, next_state), next_state, "sufficient")

    if state.phase == "deep_dive":
        if state.deep_dive_turns == 0:
            if _word_count(answer) < 4:
                return InterviewResult(
                    "Could you give a concrete example and explain the reasoning behind it?",
                    state,
                    "needs_probe",
                )
            next_state = replace(state, deep_dive_turns=1)
            return InterviewResult(MOVE_NEXT_QUESTION, next_state, "sufficient")
        if _is_affirmative(answer):
            return _next_section_or_close(domain_name, state)
        topic = state.deep_dive_topic or "that topic"
        return InterviewResult(
            f"What else should the knowledge base capture about {topic}?",
            state,
            "needs_probe",
        )

    if state.phase == "transition":
        if _is_affirmative(answer):
            return _next_section_or_close(domain_name, state)
        next_state = replace(state, phase="deep_dive_topic")
        return InterviewResult(
            "Which topic should we explore further before moving on?",
            next_state,
            "needs_probe",
        )

    section = contract["sections"][state.section_order - 1]
    minimum = current_question_minimum_words(domain_name, state)
    assessment = _assess(answer, minimum)
    if assessment != "sufficient":
        next_state = replace(state, probe_count=state.probe_count + 1)
        reply = (
            "Could you answer that question in your own words?"
            if assessment == "filler"
            else "Could you make that more specific with your reasoning, an exception, or a concrete example?"
        )
        return InterviewResult(reply, next_state, assessment)

    if state.question_index + 1 < len(section["questions"]):
        next_state = replace(
            state,
            question_index=state.question_index + 1,
            probe_count=0,
        )
        return InterviewResult(
            current_question(domain_name, next_state),
            next_state,
            assessment,
        )

    next_state = replace(state, phase="deep_dive_offer", probe_count=0)
    return InterviewResult(DEEP_DIVE_QUESTION, next_state, assessment)


def replay(domain_name: str, expert_answers: list[str]) -> InterviewState:
    state = InterviewState()
    for answer in expert_answers:
        state = advance(domain_name, state, answer).state
    return state


def _next_section_or_close(
    domain_name: str,
    state: InterviewState,
) -> InterviewResult:
    section_count = len(_CONTRACTS[domain_name]["sections"])
    if state.section_order >= section_count:
        next_state = replace(state, phase="closure", awaiting_answer=True)
        return InterviewResult(
            _CONTRACTS[domain_name]["closingLine"],
            next_state,
            "sufficient",
        )
    next_state = replace(
        state,
        section_order=state.section_order + 1,
        question_index=0,
        phase="question",
        awaiting_answer=True,
        probe_count=0,
        deep_dive_topic=None,
        deep_dive_turns=0,
    )
    return InterviewResult(
        current_question(domain_name, next_state),
        next_state,
        "sufficient",
    )


def _normalized(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", text.lower())).strip()


def _word_count(text: str) -> int:
    return len(text.strip().split())


def _is_filler(text: str) -> bool:
    return bool(
        re.fullmatch(
            r"(|yes|yeah|yep|no|nope|ok|okay|sure|exactly|mm+hmm|can you repeat|repeat that)",
            _normalized(text),
        )
    )


def _is_affirmative(text: str) -> bool:
    return bool(
        re.match(
            r"^(yes|yeah|yep|sure|okay|ok|please do|move on|next)(\b|$)",
            _normalized(text),
        )
    )


def _is_negative(text: str) -> bool:
    return bool(
        re.match(
            r"^(no|nope|nothing|not really|that is all|thats all|move on|next)(\b|$)",
            _normalized(text),
        )
    )


def _assess(text: str, minimum_words: int) -> str:
    if minimum_words <= 1 and _word_count(text) >= 1:
        return "sufficient"
    if _is_filler(text):
        return "filler"
    return "sufficient" if _word_count(text) >= minimum_words else "needs_probe"

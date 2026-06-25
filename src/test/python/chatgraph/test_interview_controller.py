"""Behavioral tests for the canonical expert interview controller."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import re


ROOT = Path(__file__).resolve().parents[4]
INTERVIEW_PATH = ROOT / "src/main/python/chatgraph/chat/interview.py"
SPEC = importlib.util.spec_from_file_location(
    "expert_interview_contract", INTERVIEW_PATH
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
DEEP_DIVE_QUESTION = MODULE.DEEP_DIVE_QUESTION
MOVE_NEXT_QUESTION = MODULE.MOVE_NEXT_QUESTION
InterviewState = MODULE.InterviewState
advance = MODULE.advance
current_question = MODULE.current_question
CONTRACTS = json.loads(
    (ROOT / "config/expert-interviews.json").read_text(encoding="utf-8")
)


def _normalized(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", text.lower())).strip()


def test_catalog_questions_come_from_canonical_txt_prompts() -> None:
    sources = {
        "hypertension": ROOT / "hypertension/Prompt Hypetension.txt",
        "hospitality": ROOT / "hospitality/prompt Hospitality .txt",
    }
    for domain_name, source in sources.items():
        canonical = _normalized(source.read_text(encoding="utf-8-sig"))
        for section in CONTRACTS[domain_name]["sections"]:
            for question in section["questions"]:
                assert _normalized(question) in canonical


def test_every_canonical_question_is_asked_in_order() -> None:
    for domain_name, contract in CONTRACTS.items():
        state = InterviewState()
        asked = [current_question(domain_name, state)]
        result = None

        for _section in contract["sections"]:
            while state.phase == "question":
                result = advance(
                    domain_name,
                    state,
                    "A sufficiently detailed expert answer with reasoning and an example.",
                )
                state = result.state
                if state.phase == "question":
                    asked.append(result.reply)
            assert result.reply == DEEP_DIVE_QUESTION
            result = advance(domain_name, state, "No, move on.")
            state = result.state
            if state.phase == "question":
                asked.append(result.reply)

        expected = [
            question
            for section in contract["sections"]
            for question in section["questions"]
        ]
        assert asked == expected
        assert state.phase == "closure"
        assert result.reply == contract["closingLine"]


def test_filler_and_probe_do_not_advance() -> None:
    state = InterviewState()
    result = advance("hospitality", state, "Okay")
    assert result.assessment == "filler"
    assert result.state.question_index == 0

    result = advance("hospitality", result.state, "I own a hotel.")
    assert result.assessment == "sufficient"
    assert result.state.question_index == 1


def test_deep_dive_requires_explicit_confirmation() -> None:
    last_intro = len(CONTRACTS["hypertension"]["sections"][0]["questions"]) - 1
    state = InterviewState(question_index=last_intro, awaiting_answer=True)
    result = advance(
        "hypertension",
        state,
        "I prefer detailed discussion with concrete examples.",
    )
    assert result.reply == DEEP_DIVE_QUESTION
    result = advance("hypertension", result.state, "Yes")
    result = advance("hypertension", result.state, "Diagnostic thresholds")
    result = advance(
        "hypertension",
        result.state,
        "Measurement context changes the threshold outside the clinic.",
    )
    assert result.reply == MOVE_NEXT_QUESTION
    result = advance("hypertension", result.state, "Yes")
    assert result.state.section_order == 2

import interviewContractsRaw from "../config/expert-interviews.json" with { type: "json" };
import type { DomainId, InterviewState } from "./types";

export const DEEP_DIVE_QUESTION =
  "Before we move on, would you like to go deeper into anything from this section?";
export const MOVE_NEXT_QUESTION = "Is it okay to move to the next question?";

type InterviewSection = {
  order: number;
  questions: string[];
  minimumWords?: number[];
};

type InterviewContract = {
  openingLine: string;
  closingLine: string;
  sections: InterviewSection[];
};

const CONTRACTS = interviewContractsRaw as Record<
  "hypertension" | "hospitality",
  InterviewContract
>;

export function isExpertDomain(
  domainId: DomainId
): domainId is "hypertension" | "hospitality" {
  return domainId === "hypertension" || domainId === "hospitality";
}

export function interviewContract(domainId: DomainId): InterviewContract | null {
  return isExpertDomain(domainId) ? CONTRACTS[domainId] : null;
}

export function initialInterviewState(domainId: DomainId): InterviewState | undefined {
  if (!isExpertDomain(domainId)) return undefined;
  return {
    sectionOrder: 1,
    questionIndex: 0,
    phase: "question",
    awaitingAnswer: true,
    probeCount: 0,
    deepDiveTurns: 0
  };
}

export function currentQuestionMinimumWords(
  domainId: DomainId,
  state: InterviewState
): number {
  const contract = interviewContract(domainId);
  const section = contract?.sections[state.sectionOrder - 1];
  return section?.minimumWords?.[state.questionIndex] ?? 3;
}

export function replayInterview(
  domainId: DomainId,
  expertAnswers: string[]
): InterviewState | undefined {
  let state = initialInterviewState(domainId);
  if (!state || !isExpertDomain(domainId)) return state;
  for (const answer of expertAnswers) {
    state = advanceInterview(domainId, state, answer).state;
  }
  return state;
}

export function currentInterviewQuestion(
  domainId: DomainId,
  state: InterviewState
): string {
  const contract = interviewContract(domainId);
  if (!contract) return "";
  const section = contract.sections[state.sectionOrder - 1];
  return section?.questions[state.questionIndex] ?? "";
}

export function interviewInstruction(
  domainId: DomainId,
  state: InterviewState
): string {
  if (!isExpertDomain(domainId)) return "";
  const question = currentInterviewQuestion(domainId, state);
  const next = previewInterviewReply(domainId, state);
  return [
    "The interview controller is authoritative.",
    `Controller phase: ${state.phase}.`,
    question ? `Current canonical question: "${question}"` : "",
    `Your next response must be exactly: "${next}"`,
    "Do not add a second question or mention sections, scripts, or controller state."
  ].filter(Boolean).join("\n");
}

export function previewInterviewReply(
  domainId: DomainId,
  state: InterviewState
): string {
  const contract = interviewContract(domainId);
  if (!contract) return "";
  if (state.phase === "closure" || state.phase === "complete") {
    return contract.closingLine;
  }
  if (state.phase === "deep_dive_offer") return DEEP_DIVE_QUESTION;
  if (state.phase === "deep_dive_topic") {
    return "Which topic from this section would you like to explore more deeply?";
  }
  if (state.phase === "deep_dive") {
    return state.deepDiveTurns === 0
      ? `What is the most important reasoning, exception, or example behind ${state.deepDiveTopic ?? "that topic"}?`
      : MOVE_NEXT_QUESTION;
  }
  if (state.phase === "transition") return MOVE_NEXT_QUESTION;
  return currentInterviewQuestion(domainId, state);
}

export function advanceInterview(
  domainId: DomainId,
  inputState: InterviewState,
  answer: string
): { reply: string; state: InterviewState; assessment: "sufficient" | "needs_probe" | "filler" } {
  const contract = interviewContract(domainId);
  if (!contract) {
    return { reply: "", state: inputState, assessment: "sufficient" };
  }
  const state = { ...inputState };

  if (!state.awaitingAnswer) {
    state.awaitingAnswer = true;
    return {
      reply: previewInterviewReply(domainId, state),
      state,
      assessment: "sufficient"
    };
  }

  if (state.phase === "closure" || state.phase === "complete") {
    state.phase = "complete";
    return { reply: contract.closingLine, state, assessment: "sufficient" };
  }

  if (state.phase === "deep_dive_offer") {
    if (isNegative(answer)) {
      return enterNextSectionOrClosure(domainId, state, contract);
    }
    state.phase = "deep_dive_topic";
    state.awaitingAnswer = true;
    return {
      reply: previewInterviewReply(domainId, state),
      state,
      assessment: "sufficient"
    };
  }

  if (state.phase === "deep_dive_topic") {
    if (isFiller(answer)) {
      return {
        reply: "Which specific topic would you like to explore more deeply?",
        state,
        assessment: "filler"
      };
    }
    state.deepDiveTopic = answer.trim();
    state.deepDiveTurns = 0;
    state.phase = "deep_dive";
    return {
      reply: previewInterviewReply(domainId, state),
      state,
      assessment: "sufficient"
    };
  }

  if (state.phase === "deep_dive") {
    if (state.deepDiveTurns === 0) {
      if (wordCount(answer) < 4) {
        return {
          reply: "Could you give a concrete example and explain the reasoning behind it?",
          state,
          assessment: "needs_probe"
        };
      }
      state.deepDiveTurns = 1;
      return {
        reply: MOVE_NEXT_QUESTION,
        state,
        assessment: "sufficient"
      };
    }
    if (isAffirmative(answer)) {
      return enterNextSectionOrClosure(domainId, state, contract);
    }
    return {
      reply: `What else should the knowledge base capture about ${state.deepDiveTopic ?? "that topic"}?`,
      state,
      assessment: "needs_probe"
    };
  }

  if (state.phase === "transition") {
    if (isAffirmative(answer)) {
      return enterNextSectionOrClosure(domainId, state, contract);
    }
    state.phase = "deep_dive_topic";
    return {
      reply: "Which topic should we explore further before moving on?",
      state,
      assessment: "needs_probe"
    };
  }

  const section = contract.sections[state.sectionOrder - 1];
  const minimumWords = currentQuestionMinimumWords(domainId, state);
  const assessment = assessAnswer(answer, minimumWords);
  if (assessment !== "sufficient") {
    state.probeCount += 1;
    return {
      reply:
        assessment === "filler"
          ? "Could you answer that question in your own words?"
          : "Could you make that more specific with your reasoning, an exception, or a concrete example?",
      state,
      assessment
    };
  }

  state.probeCount = 0;
  if (state.questionIndex + 1 < section.questions.length) {
    state.questionIndex += 1;
    return {
      reply: section.questions[state.questionIndex],
      state,
      assessment
    };
  }

  state.phase = "deep_dive_offer";
  return { reply: DEEP_DIVE_QUESTION, state, assessment };
}

function enterNextSectionOrClosure(
  domainId: DomainId,
  state: InterviewState,
  contract: InterviewContract
) {
  if (state.sectionOrder >= contract.sections.length) {
    state.phase = "closure" as const;
    state.awaitingAnswer = true;
    return {
      reply: contract.closingLine,
      state,
      assessment: "sufficient" as const
    };
  }
  state.sectionOrder += 1;
  state.questionIndex = 0;
  state.phase = "question";
  state.awaitingAnswer = true;
  state.deepDiveTopic = undefined;
  state.deepDiveTurns = 0;
  return {
    reply: currentInterviewQuestion(domainId, state),
    state,
    assessment: "sufficient" as const
  };
}

function assessAnswer(
  answer: string,
  minimumWords: number
): "sufficient" | "needs_probe" | "filler" {
  if (minimumWords <= 1 && wordCount(answer) >= 1) return "sufficient";
  if (isFiller(answer)) return "filler";
  return wordCount(answer) >= minimumWords ? "sufficient" : "needs_probe";
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function isFiller(text: string): boolean {
  return /^(|yes|yeah|yep|no|nope|ok|okay|sure|exactly|mm+hmm|can you repeat|repeat that)$/.test(
    normalized(text)
  );
}

function isAffirmative(text: string): boolean {
  return /^(yes|yeah|yep|sure|okay|ok|please do|move on|next)(\b|$)/.test(normalized(text));
}

function isNegative(text: string): boolean {
  return /^(no|nope|nothing|not really|that is all|thats all|move on|next)(\b|$)/.test(
    normalized(text)
  );
}

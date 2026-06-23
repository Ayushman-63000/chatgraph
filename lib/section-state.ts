import type { ChatMessage } from "./types";

export const DEEP_DIVE_QUESTION =
  "Before we move on, would you like to go deeper into anything from this section?";
export const MOVE_NEXT_QUESTION = "Is it okay to move to the next question?";

export function nextSectionOrder(
  current: number,
  sectionCount: number,
  messages: ChatMessage[]
): number {
  let latestUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      latestUser = index;
      break;
    }
  }
  if (latestUser < 0) return current;
  let interviewer = "";
  for (let index = latestUser - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      interviewer = messages[index].content;
      break;
    }
  }
  const answer = messages[latestUser]?.content ?? "";
  const advance =
    (interviewer.includes(DEEP_DIVE_QUESTION) &&
      isNegativeTransitionAnswer(answer)) ||
    (interviewer.includes(MOVE_NEXT_QUESTION) &&
      isAffirmativeTransitionAnswer(answer));
  return advance ? Math.min(sectionCount, current + 1) : current;
}

function normalizedAnswer(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function isNegativeTransitionAnswer(text: string): boolean {
  return /^(no|nope|nothing|not really|that is all|thats all|move on|next)(\b|$)/.test(
    normalizedAnswer(text)
  );
}

function isAffirmativeTransitionAnswer(text: string): boolean {
  return /^(yes|yeah|yep|sure|okay|ok|please do|move on|next)(\b|$)/.test(
    normalizedAnswer(text)
  );
}

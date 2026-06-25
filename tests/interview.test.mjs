import assert from "node:assert/strict";
import test from "node:test";

import {
  DEEP_DIVE_QUESTION,
  MOVE_NEXT_QUESTION,
  advanceInterview,
  currentInterviewQuestion,
  initialInterviewState,
  interviewContract
} from "../lib/interview.ts";

for (const domainId of ["hypertension", "hospitality"]) {
  test(`${domainId} asks every canonical question in order`, () => {
    const contract = interviewContract(domainId);
    let state = initialInterviewState(domainId);
    const asked = [currentInterviewQuestion(domainId, state)];
    let result;

    for (let sectionIndex = 0; sectionIndex < contract.sections.length; sectionIndex += 1) {
      while (state.phase === "question") {
        result = advanceInterview(
          domainId,
          state,
          "A sufficiently detailed expert answer with reasoning and an example."
        );
        state = result.state;
        if (state.phase === "question") asked.push(result.reply);
      }
      assert.equal(result.reply, DEEP_DIVE_QUESTION);
      result = advanceInterview(domainId, state, "No, move on.");
      state = result.state;
      if (state.phase === "question") asked.push(result.reply);
    }

    assert.deepEqual(
      asked,
      contract.sections.flatMap((section) => section.questions)
    );
    assert.equal(state.phase, "closure");
    assert.equal(result.reply, contract.closingLine);
  });
}

test("filler retains the current question and substantive detail advances", () => {
  let state = initialInterviewState("hospitality");
  const firstQuestion = currentInterviewQuestion("hospitality", state);

  let result = advanceInterview("hospitality", state, "Okay");
  assert.equal(result.assessment, "filler");
  assert.equal(result.state.questionIndex, 0);
  assert.notEqual(result.reply, firstQuestion);

  result = advanceInterview(
    "hospitality",
    result.state,
    "I own a small boutique hotel and have operated it for twelve years."
  );
  assert.equal(result.assessment, "sufficient");
  assert.equal(result.state.questionIndex, 1);
});

test("deep dive requires topic, detail, and explicit move-next confirmation", () => {
  const contract = interviewContract("hypertension");
  let state = {
    ...initialInterviewState("hypertension"),
    questionIndex: contract.sections[0].questions.length - 1,
    awaitingAnswer: true
  };
  let result = advanceInterview(
    "hypertension",
    state,
    "I prefer a detailed discussion with concrete cases."
  );
  assert.equal(result.reply, DEEP_DIVE_QUESTION);

  result = advanceInterview("hypertension", result.state, "Yes");
  assert.match(result.reply, /Which topic/);
  result = advanceInterview("hypertension", result.state, "Diagnostic thresholds");
  assert.match(result.reply, /reasoning/);
  result = advanceInterview(
    "hypertension",
    result.state,
    "Measurement context changes the threshold, especially outside the clinic."
  );
  assert.equal(result.reply, MOVE_NEXT_QUESTION);
  result = advanceInterview("hypertension", result.state, "Yes");
  assert.equal(result.state.sectionOrder, 2);
  assert.equal(result.reply, contract.sections[1].questions[0]);
});

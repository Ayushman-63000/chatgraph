import assert from "node:assert/strict";
import test from "node:test";

import {
  DEEP_DIVE_QUESTION,
  MOVE_NEXT_QUESTION,
  nextSectionOrder
} from "../lib/section-state.ts";

function message(role, content) {
  return { id: crypto.randomUUID(), role, content, createdAt: Date.now() };
}

test("section advances only after explicit transition response", () => {
  assert.equal(
    nextSectionOrder(2, 7, [
      message("assistant", DEEP_DIVE_QUESTION),
      message("user", "No, let's move on.")
    ]),
    3
  );
  assert.equal(
    nextSectionOrder(2, 7, [
      message("assistant", DEEP_DIVE_QUESTION),
      message("user", "Yes, guest signals.")
    ]),
    2
  );
  assert.equal(
    nextSectionOrder(2, 7, [
      message("assistant", MOVE_NEXT_QUESTION),
      message("user", "Yes.")
    ]),
    3
  );
});

test("section state never skips or exceeds section count", () => {
  assert.equal(
    nextSectionOrder(7, 7, [
      message("assistant", DEEP_DIVE_QUESTION),
      message("user", "No.")
    ]),
    7
  );
  assert.equal(
    nextSectionOrder(3, 7, [
      message("assistant", "Tell me about loyalty."),
      message("user", "Guests value recognition.")
    ]),
    3
  );
});

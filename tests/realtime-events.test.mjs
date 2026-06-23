import assert from "node:assert/strict";
import test from "node:test";
import { RealtimeTranscriptCollector } from "../lib/realtime-events.ts";

test("emits each user transcript item once", () => {
  const collector = new RealtimeTranscriptCollector();
  const event = {
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "user-item-1",
    transcript: "My practice is 10 years."
  };

  assert.equal(collector.collect(event).length, 1);
  assert.equal(collector.collect(event).length, 0);
});

test("does not emit an assistant item again at response.done", () => {
  const collector = new RealtimeTranscriptCollector();

  const transcript = collector.collect({
    type: "response.output_audio_transcript.done",
    response_id: "response-1",
    item_id: "assistant-item-1",
    transcript: "Thanks, that is helpful context."
  });
  const completedResponse = collector.collect({
    type: "response.done",
    response: {
      id: "response-1",
      status: "completed",
      output: [{
        id: "assistant-item-1",
        type: "message",
        role: "assistant",
        content: [{ transcript: "Thanks, that is helpful context." }]
      }]
    }
  });

  assert.equal(transcript.length, 1);
  assert.equal(completedResponse.length, 0);
});

test("uses response.done as a fallback when no transcript done event arrives", () => {
  const collector = new RealtimeTranscriptCollector();

  const transcript = collector.collect({
    type: "response.done",
    response: {
      id: "response-2",
      status: "completed",
      output: [{
        id: "assistant-item-2",
        type: "message",
        role: "assistant",
        content: [{ transcript: "Fallback transcript." }]
      }]
    }
  });

  assert.equal(transcript.length, 1);
  assert.equal(transcript[0].text, "Fallback transcript.");
});

test("does not persist cancelled or incomplete assistant responses", () => {
  const collector = new RealtimeTranscriptCollector();

  assert.equal(collector.collect({
    type: "response.done",
    response: {
      id: "response-3",
      status: "cancelled",
      output: [{
        id: "assistant-item-3",
        type: "message",
        role: "assistant",
        content: [{ transcript: "Partial response." }]
      }]
    }
  }).length, 0);
});

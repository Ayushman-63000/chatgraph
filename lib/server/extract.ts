import OpenAI from "openai";
import {
  HOSPITALITY_EXTRACTOR_INTRO,
  HOSPITALITY_SECTION_CATALOG
} from "@/lib/prompts";
import { graphSummary, sanitizeDelta, schemaReference } from "@/lib/schema";
import type { ChatRequest, GraphDelta } from "@/lib/types";

const DEFAULT_EXTRACTOR_MODEL = "gpt-4o-mini";

export async function extractGraphDelta(
  openai: OpenAI,
  latestText: string,
  body: ChatRequest
): Promise<{ delta: GraphDelta; warnings: string[] }> {
  let best: { delta: GraphDelta; warnings: string[] } = {
    delta: { vertices: [], edges: [] },
    warnings: ["Extractor did not run."]
  };
  let feedback = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await callExtractor(openai, latestText, body, feedback);
    const toolCalls = response.choices[0]?.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      best = {
        delta: { vertices: [], edges: [] },
        warnings: ["Extractor returned no graph delta."]
      };
      feedback = "The previous attempt returned no tool output. Emit the graph delta using the tool.";
      continue;
    }

    const firstCall = toolCalls[0];
    if (!("function" in firstCall)) {
      best = {
        delta: { vertices: [], edges: [] },
        warnings: ["Extractor returned unexpected tool call type."]
      };
      feedback = "Emit the graph delta using the emit_graph_delta function tool.";
      continue;
    }
    let rawInput: unknown;
    try {
      rawInput = JSON.parse(firstCall.function.arguments);
    } catch {
      best = {
        delta: { vertices: [], edges: [] },
        warnings: best.warnings
      };
      feedback = "The previous attempt returned invalid JSON. Emit valid JSON using the emit_graph_delta function.";
      continue;
    }
    const sanitized = sanitizeDelta(rawInput, body.graph);
    if (sanitized.warnings.length < best.warnings.length) best = sanitized;
    const hardWarnings = sanitized.warnings.filter(
      (warning) => !warning.startsWith("Review:")
    );
    if (hardWarnings.length === 0) return sanitized;
    feedback =
      `The previous graph delta failed validation and was sanitized with these problems:\n` +
      hardWarnings.join("\n") +
      "\n\nRe-emit the entire corrected delta. Valid schema labels and edge directions:\n" +
      schemaReference();
  }

  return best;
}

function callExtractor(
  openai: OpenAI,
  latestText: string,
  body: ChatRequest,
  feedback: string
) {
  return openai.chat.completions.create({
    model: process.env.CHATGRAPH_EXTRACTOR_MODEL || DEFAULT_EXTRACTOR_MODEL,
    max_completion_tokens: 2200,
    messages: [
      {
        role: "system",
        content: `${HOSPITALITY_EXTRACTOR_INTRO}\n\n${schemaReference()}`
      },
      {
        role: "user",
        content:
          `Session metadata:\n${extractionMetadata(body)}\n\n` +
          `Section catalog:\n${HOSPITALITY_SECTION_CATALOG.map((section) =>
            `${section.order}. ${section.sectionType} — ${section.title}`
          ).join("\n")}\n\n` +
          `Latest expert utterance:\n${latestText}\n\n` +
          `Conversation window:\n${body.messages
            .slice(-8)
            .map((message) => `${message.role}: ${message.content}`)
            .join("\n")}\n\n` +
          `Current graph:\n${graphSummary(body.graph)}` +
          (feedback ? `\n\nValidation feedback:\n${feedback}` : "")
      }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "emit_graph_delta",
          description: "Emit the graph delta captured from the latest hospitality expert utterance.",
          parameters: {
            type: "object",
            properties: {
              vertices: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    properties: { type: "object" }
                  },
                  required: ["id", "label"]
                }
              },
              edges: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    out: { type: "string" },
                    in: { type: "string" },
                    properties: { type: "object" }
                  },
                  required: ["label", "out", "in"]
                }
              }
            },
            required: ["vertices", "edges"]
          }
        }
      }
    ],
    tool_choice: { type: "function", function: { name: "emit_graph_delta" } }
  });
}

function extractionMetadata(body: ChatRequest): string {
  const session = Object.values(body.graph.vertices).find(
    (vertex) => vertex.label === "KnowledgeSession"
  );
  const sessionId = session?.id ?? `session:hospitality:${new Date().toISOString().slice(0, 10)}`;
  const expertTurns = body.messages.filter((message) => message.role === "user").length;
  const episodeId = `ep:${sessionId}:${String(expertTurns).padStart(2, "0")}`;
  const sections = Object.values(body.graph.vertices)
    .filter((vertex) => vertex.label === "SessionSection")
    .sort((a, b) => Number(a.properties.order ?? 0) - Number(b.properties.order ?? 0))
    .map((vertex) => `${vertex.id} (${vertex.properties.sectionType})`)
    .join(", ");
  return [
    `session_id: ${sessionId}`,
    `episode_id: ${episodeId}`,
    `known_sections: ${sections || "(none)"}`,
    `expert_turn_number: ${expertTurns}`
  ].join("\n");
}

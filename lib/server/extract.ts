import OpenAI from "openai";
import { getDomain } from "@/lib/domains";
import {
  activeSectionOrder,
  graphSummary,
  sectionInfrastructureDelta,
  sanitizeDelta,
  schemaReference
} from "@/lib/schema";
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
  const sectionOrder = activeSectionOrder(body.domainId, body.graph, body.messages);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await callExtractor(
      openai,
      latestText,
      body,
      feedback,
      sectionOrder
    );
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
    const sanitized = sanitizeDelta(
      rawInput,
      body.graph,
      body.domainId,
      sectionOrder
    );
    const infrastructure = sectionInfrastructureDelta(
      body.domainId,
      body.graph,
      sectionOrder
    );
    const combined = {
      ...sanitized,
      delta: {
        vertices: [
          ...infrastructure.vertices,
          ...sanitized.delta.vertices.filter(
            (vertex) => !infrastructure.vertices.some((item) => item.id === vertex.id)
          )
        ],
        edges: [
          ...infrastructure.edges,
          ...sanitized.delta.edges.filter(
            (edge) => !infrastructure.edges.some((item) => item.id === edge.id)
          )
        ]
      }
    };
    if (combined.warnings.length < best.warnings.length) best = combined;
    if (combined.errors.length === 0) return combined;
    feedback =
      `The previous graph delta failed hard validation and was rejected:\n` +
      sanitized.errors.join("\n") +
      "\n\nRe-emit the entire corrected delta. Valid schema labels and edge directions:\n" +
      schemaReference(body.domainId);
  }

  console.warn(`Dropped invalid ${body.domainId} graph delta after 3 attempts.`);
  return {
    delta: { vertices: [], edges: [] },
    warnings: [
      ...best.warnings,
      "Graph delta failed hard validation after 3 attempts and was not written."
    ]
  };
}

function callExtractor(
  openai: OpenAI,
  latestText: string,
  body: ChatRequest,
  feedback: string,
  sectionOrder: number
) {
  const domain = getDomain(body.domainId);
  const sections = domain.sectionMap?.sections ?? [];
  const activeSection = sections.find((section) => section.order === sectionOrder);
  const provenanceEdges = domain.schema.edges
    .filter((entry) => {
      const endpoint = entry["@value"].in ?? entry["@value"].inV;
      return endpoint === "ProvenanceEvidence";
    })
    .map((entry) => entry["@key"]);
  const allowedEdges = [
    ...new Set([
      ...(activeSection?.edge_patterns ?? []).map((pattern) => pattern.edge),
      ...provenanceEdges
    ])
  ];
  const sectionCatalog = sections.length
    ? sections
        .map(
          (section) =>
            `${section.order}. ${section.section_type ?? section.section_id ?? "section"} — ${section.title ?? ""}`
        )
        .join("\n")
    : "(This domain follows the patient's narrative and has no fixed section catalog.)";
  return openai.chat.completions.create({
    model: process.env.CHATGRAPH_EXTRACTOR_MODEL || DEFAULT_EXTRACTOR_MODEL,
    max_completion_tokens: 2200,
    messages: [
      {
        role: "system",
        content: `${domain.extractorPrompt}\n\n${schemaReference(body.domainId)}`
      },
      {
        role: "user",
        content:
          `Session metadata:\n${extractionMetadata(body)}\n\n` +
          `Active section (authoritative for this turn):\n` +
          `${activeSection?.section_id ?? sectionOrder}. ${activeSection?.section_type ?? "narrative"} — ${activeSection?.title ?? ""}\n` +
          `Allowed vertex labels: ${(activeSection?.primary_vertex_labels ?? []).join(", ") || "schema-driven"}\n` +
          `Allowed edge labels: ${allowedEdges.join(", ") || "schema-driven"}\n` +
          `${activeSection?.extractor_instruction ?? ""}\n\n` +
          `Section catalog:\n${sectionCatalog}\n\n` +
          `Latest ${domain.participantLabel} utterance:\n${latestText}\n\n` +
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
          description: `Emit the ${body.domainId} graph delta captured from the latest ${domain.participantLabel} utterance.`,
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
  const sessionId =
    session?.id ??
    `session:${body.domainId}:${new Date().toISOString().slice(0, 10)}`;
  const participantTurns = body.messages.filter((message) => message.role === "user").length;
  const episodeId = `ep:${sessionId}:${String(participantTurns).padStart(2, "0")}`;
  const sections = Object.values(body.graph.vertices)
    .filter((vertex) => vertex.label === "SessionSection")
    .sort((a, b) => Number(a.properties.order ?? 0) - Number(b.properties.order ?? 0))
    .map((vertex) => `${vertex.id} (${vertex.properties.sectionType})`)
    .join(", ");
  return [
    `session_id: ${sessionId}`,
    `episode_id: ${episodeId}`,
    `known_sections: ${sections || "(none)"}`,
    `participant_turn_number: ${participantTurns}`
  ].join("\n");
}

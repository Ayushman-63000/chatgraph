import OpenAI from "openai";
import { getDomain } from "@/lib/domains";
import {
  currentQuestionMinimumWords,
  isExpertDomain
} from "@/lib/interview";
import {
  mergeDelta,
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
  if (
    body.domainId === "hospitality" &&
    (!body.interview ||
      !isExpertDomain(body.domainId) ||
      currentQuestionMinimumWords(body.domainId, body.interview) > 1) &&
    latestText.trim().split(/\s+/).length < 5 &&
    /^(yes|no|okay|ok|sure|exactly|mm+hmm|can you repeat that)$/i.test(latestText.trim())
  ) {
    const sectionOrder = body.interview?.sectionOrder ?? 1;
    const infrastructure = sectionInfrastructureDelta(
      body.domainId,
      body.graph,
      sectionOrder
    );
    const graphWithSection = mergeDelta(body.graph, infrastructure);
    const episode = expertEpisodeDelta(
      body,
      graphWithSection,
      latestText,
      sectionOrder
    );
    return {
      delta: mergeGraphDeltas(infrastructure, episode),
      warnings: []
    };
  }
  const chunks =
    body.domainId === "hospitality"
      ? splitAtSentenceBoundary(latestText, 600)
      : [latestText];
  if (chunks.length > 1) {
    let graph = body.graph;
    let combined: GraphDelta = { vertices: [], edges: [] };
    const warnings: string[] = [];
    for (const chunk of chunks) {
      const result = await extractSingleGraphDelta(openai, chunk, {
        ...body,
        graph
      });
      combined = mergeGraphDeltas(combined, result.delta);
      graph = mergeDelta(graph, result.delta);
      warnings.push(...result.warnings);
    }
    return { delta: combined, warnings };
  }
  return extractSingleGraphDelta(openai, latestText, body);
}

async function extractSingleGraphDelta(
  openai: OpenAI,
  latestText: string,
  body: ChatRequest
): Promise<{ delta: GraphDelta; warnings: string[] }> {
  let best: { delta: GraphDelta; warnings: string[] } = {
    delta: { vertices: [], edges: [] },
    warnings: ["Extractor did not run."]
  };
  let feedback = "";
  const sectionOrder = body.interview?.sectionOrder ?? 1;
  const infrastructure = sectionInfrastructureDelta(
    body.domainId,
    body.graph,
    sectionOrder
  );
  const graphWithSection = mergeDelta(body.graph, infrastructure);
  const episode = expertEpisodeDelta(
    body,
    graphWithSection,
    latestText,
    sectionOrder
  );
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
    const schemaGapWarnings =
      body.domainId === "hospitality" &&
      typeof rawInput === "object" &&
      rawInput !== null &&
      Array.isArray((rawInput as { schema_gaps?: unknown }).schema_gaps)
        ? ((rawInput as { schema_gaps: unknown[] }).schema_gaps)
            .map((item) => String(item).trim())
            .filter(Boolean)
            .map((item) => `SCHEMA_GAP: ${item}`)
        : [];
    const augmentedInput = augmentWithEpisode(rawInput, episode);
    const sanitized = sanitizeDelta(
      augmentedInput,
      graphWithSection,
      body.domainId,
      sectionOrder
    );
    const combined = {
      ...sanitized,
      warnings: [...sanitized.warnings, ...schemaGapWarnings],
      delta: {
        vertices: [
          ...infrastructure.vertices,
          ...episode.vertices,
          ...sanitized.delta.vertices.filter(
            (vertex) =>
              !infrastructure.vertices.some((item) => item.id === vertex.id) &&
              !episode.vertices.some((item) => item.id === vertex.id)
          )
        ],
        edges: [
          ...infrastructure.edges,
          ...episode.edges,
          ...sanitized.delta.edges.filter(
            (edge) =>
              !infrastructure.edges.some((item) => item.id === edge.id) &&
              !episode.edges.some((item) => item.id === edge.id)
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

function mergeGraphDeltas(...deltas: GraphDelta[]): GraphDelta {
  const vertices = new Map<string, GraphDelta["vertices"][number]>();
  const edges = new Map<string, GraphDelta["edges"][number]>();
  for (const delta of deltas) {
    for (const vertex of delta.vertices) vertices.set(vertex.id, vertex);
    for (const edge of delta.edges) edges.set(edge.id, edge);
  }
  return { vertices: [...vertices.values()], edges: [...edges.values()] };
}

function splitAtSentenceBoundary(text: string, maxWords: number): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = `${current} ${sentence}`.trim();
    if (current && candidate.split(/\s+/).length > maxWords) {
      chunks.push(current.trim());
      current = sentence.trim();
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

function augmentWithEpisode(input: unknown, episode: GraphDelta): unknown {
  const raw =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? input as { vertices?: unknown; edges?: unknown; schema_gaps?: unknown }
      : {};
  const vertices = Array.isArray(raw.vertices) ? raw.vertices : [];
  const edges = Array.isArray(raw.edges) ? raw.edges : [];
  return {
    vertices: [
      ...episode.vertices,
      ...vertices.filter(
        (item) =>
          typeof item !== "object" ||
          item === null ||
          (item as { id?: unknown }).id !== episode.vertices[0]?.id
      )
    ],
    edges: [
      ...episode.edges,
      ...edges.filter(
        (item) =>
          typeof item !== "object" ||
          item === null ||
          (item as { id?: unknown }).id !== episode.edges[0]?.id
      )
    ],
    schema_gaps: Array.isArray(raw.schema_gaps) ? raw.schema_gaps : []
  };
}

function expertEpisodeDelta(
  body: ChatRequest,
  graph: ChatRequest["graph"],
  latestText: string,
  sectionOrder: number
): GraphDelta {
  const session = Object.values(graph.vertices).find(
    (vertex) => vertex.label === "KnowledgeSession"
  );
  const section = Object.values(graph.vertices).find(
    (vertex) =>
      vertex.label === "SessionSection" &&
      Number(vertex.properties.order) === sectionOrder
  );
  if (!session || !section) return { vertices: [], edges: [] };
  const episodeId = nextEpisodeId(graph, session.id);
  return {
    vertices: [{
      id: episodeId,
      label: "TranscriptEpisode",
      properties: { verbatimText: latestText, speaker: "expert" }
    }],
    edges: [{
      id: `${section.id}-hasEpisode->${episodeId}`,
      label: "hasEpisode",
      out: section.id,
      in: episodeId,
      properties: {}
    }]
  };
}

export function nextEpisodeId(
  graph: ChatRequest["graph"],
  sessionId: string,
  offset = 0
): string {
  const count = Object.values(graph.vertices).filter(
    (vertex) => vertex.label === "TranscriptEpisode"
  ).length;
  return `ep:${sessionId}:${String(count + 1 + offset).padStart(2, "0")}`;
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
  const allowedVertices = activeSection?.primary_vertex_labels?.length
    ? activeSection.primary_vertex_labels
    : domain.schema.vertices.map((entry) => entry["@key"]);
  const sectionCatalog = sections.length
    ? sections
        .map(
          (section) =>
            `${section.order}. ${section.section_type ?? section.section_id ?? "section"} — ${section.title ?? ""}`
        )
        .join("\n")
    : "(This domain follows the patient's narrative and has no fixed section catalog.)";
  const conversationWindowSize = body.domainId === "hospitality" ? 8 : 6;
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
            .slice(-conversationWindowSize)
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
                    label: { type: "string", enum: allowedVertices },
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
                    label: { type: "string", enum: allowedEdges },
                    out: { type: "string" },
                    in: { type: "string" },
                    properties: { type: "object" }
                  },
                  required: ["label", "out", "in"]
                }
              },
              schema_gaps: {
                type: "array",
                items: { type: "string" },
                description:
                  "Hospitality only: substantive knowledge that fits no declared schema label. Never invent a label."
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
  const episodeId = nextEpisodeId(body.graph, sessionId);
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

import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getDomain, isDomainId } from "@/lib/domains";
import { extractGraphDelta } from "@/lib/server/extract";
import {
  graphMatchesDomain,
  mergeDelta,
  sectionInfrastructureDelta,
  validateSessionGraph
} from "@/lib/schema";
import {
  advanceInterview,
  initialInterviewState,
  isExpertDomain
} from "@/lib/interview";
import { nextEpisodeId } from "@/lib/server/extract";
import type { ChatMessage, ChatRequest, GraphDelta } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_AGENT_MODEL = "gpt-4o";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 }
    );
  }

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    !isDomainId(body.domainId) ||
    !Array.isArray(body.messages) ||
    !body.graph?.vertices ||
    !body.graph?.edges
  ) {
    return NextResponse.json({ error: "Invalid chat request." }, { status: 400 });
  }
  if (!graphMatchesDomain(body.graph, body.domainId)) {
    return NextResponse.json(
      { error: "Session domain does not match graph domain. Reset the session." },
      { status: 409 }
    );
  }

  const latestUser = [...body.messages].reverse().find((message) => message.role === "user");
  if (!latestUser?.content.trim()) {
    return NextResponse.json({ error: "No user message found." }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey });
  const domain = getDomain(body.domainId);
  const interviewResult = isExpertDomain(body.domainId)
    ? advanceInterview(
        body.domainId,
        body.interview ?? initialInterviewState(body.domainId)!,
        latestUser.content
      )
    : null;
  const agentPromise = interviewResult
    ? Promise.resolve(interviewResult.reply)
    : runAgent(openai, body.messages, domain.conversationPrompt);
  const extractorPromise = extractGraphDelta(openai, latestUser.content, body);
  const [agentResult, extractorResult] = await Promise.allSettled([
    agentPromise,
    extractorPromise
  ]);

  if (agentResult.status === "rejected") {
    return NextResponse.json(
      { error: "Assistant generation failed." },
      { status: 502 }
    );
  }

  const warnings: string[] = [];
  let delta: GraphDelta = { vertices: [], edges: [] };
  if (extractorResult.status === "fulfilled") {
    delta = extractorResult.value.delta;
    warnings.push(...extractorResult.value.warnings);
  } else {
    warnings.push("Graph extraction failed for this turn.");
  }

  if (interviewResult) {
    const assistantInfrastructure = sectionInfrastructureDelta(
      body.domainId,
      mergeDelta(body.graph, delta),
      interviewResult.state.sectionOrder
    );
    delta = mergeGraphDeltas(delta, assistantInfrastructure);
    delta = mergeGraphDeltas(
      delta,
      interviewerEpisodeDelta(
        body,
        delta,
        interviewResult.reply,
        interviewResult.state.sectionOrder
      )
    );
  }

  const assistantMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: agentResult.value,
    createdAt: Date.now()
  };

  const schemaGapAudit = warnings
    .filter((warning) => warning.startsWith("SCHEMA_GAP:"))
    .map((warning) => ({
      ruleId: "SCHEMA_GAP",
      severity: "advisory" as const,
      message: warning.slice("SCHEMA_GAP:".length).trim()
    }));
  const closureAudit =
    interviewResult?.state.phase === "closure" ||
    interviewResult?.state.phase === "complete"
      ? validateSessionGraph(mergeDelta(body.graph, delta), body.domainId)
      : [];
  const audit = [
    ...new Map(
      [...(body.audit ?? []), ...schemaGapAudit, ...closureAudit].map((finding) => [
        `${finding.ruleId}\u0000${finding.message}`,
        finding
      ])
    ).values()
  ];
  return NextResponse.json({
    assistantMessage,
    delta,
    warnings,
    interview: interviewResult?.state,
    audit
  });
}

async function runAgent(
  openai: OpenAI,
  messages: ChatMessage[],
  systemPrompt: string
): Promise<string> {
  const normalizedMessages = normalizeOpenAIMessages(messages);
  const response = await openai.chat.completions.create({
    model: process.env.CHATGRAPH_AGENT_MODEL || DEFAULT_AGENT_MODEL,
    max_completion_tokens: 420,
    messages: [
      { role: "system", content: systemPrompt },
      ...normalizedMessages.slice(-40).map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content
      }))
    ]
  });
  const text = response.choices[0].message.content?.trim();
  return enforceOneQuestion(text || "I hear you. Could you tell me a little more?");
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

function interviewerEpisodeDelta(
  body: ChatRequest,
  pending: GraphDelta,
  text: string,
  sectionOrder: number
): GraphDelta {
  const graph = mergeDelta(body.graph, pending);
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
      properties: { verbatimText: text, speaker: "interviewer" }
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

function normalizeOpenAIMessages(messages: ChatMessage[]): ChatMessage[] {
  const nonEmpty = messages.filter((message) => message.content.trim());
  const firstUserIndex = nonEmpty.findIndex((message) => message.role === "user");
  if (firstUserIndex < 0) return [];
  return nonEmpty.slice(firstUserIndex);
}

function enforceOneQuestion(text: string): string {
  const firstQuestion = text.indexOf("?");
  if (firstQuestion < 0) return text;
  return text.slice(0, firstQuestion + 1).trim();
}

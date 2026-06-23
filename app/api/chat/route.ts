import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getDomain, isDomainId } from "@/lib/domains";
import { extractGraphDelta } from "@/lib/server/extract";
import {
  activeSectionInstruction,
  activeSectionOrder,
  graphMatchesDomain
} from "@/lib/schema";
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
  const sectionOrder = activeSectionOrder(body.domainId, body.graph, body.messages);
  const agentPromise = runAgent(
    openai,
    body.messages,
    domain.conversationPrompt,
    activeSectionInstruction(body.domainId, sectionOrder)
  );
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

  const assistantMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: agentResult.value,
    createdAt: Date.now()
  };

  return NextResponse.json({ assistantMessage, delta, warnings });
}

async function runAgent(
  openai: OpenAI,
  messages: ChatMessage[],
  systemPrompt: string,
  sectionInstruction: string
): Promise<string> {
  const normalizedMessages = normalizeOpenAIMessages(messages);
  const response = await openai.chat.completions.create({
    model: process.env.CHATGRAPH_AGENT_MODEL || DEFAULT_AGENT_MODEL,
    max_completion_tokens: 420,
    messages: [
      {
        role: "system",
        content: sectionInstruction
          ? `${systemPrompt}\n\n${sectionInstruction}`
          : systemPrompt
      },
      ...normalizedMessages.slice(-40).map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content
      }))
    ]
  });
  const text = response.choices[0].message.content?.trim();
  return enforceOneQuestion(text || "I hear you. Could you tell me a little more?");
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

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ChatRole = "user" | "assistant";
export type DomainId = "headache" | "hypertension" | "hospitality";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  sourceId?: string;
}

export type InterviewPhase =
  | "question"
  | "deep_dive_offer"
  | "deep_dive_topic"
  | "deep_dive"
  | "transition"
  | "closure"
  | "complete";

export interface InterviewState {
  sectionOrder: number;
  questionIndex: number;
  phase: InterviewPhase;
  awaitingAnswer: boolean;
  probeCount: number;
  deepDiveTopic?: string;
  deepDiveTurns: number;
}

export interface AuditFinding {
  ruleId: string;
  severity: "hard" | "soft" | "advisory";
  message: string;
}

export interface GraphVertex {
  id: string;
  label: string;
  properties: Record<string, JsonValue>;
}

export interface GraphEdge {
  id: string;
  label: string;
  out: string;
  in: string;
  properties: Record<string, JsonValue>;
}

export interface GraphState {
  vertices: Record<string, GraphVertex>;
  edges: Record<string, GraphEdge>;
}

export interface GraphDelta {
  vertices: GraphVertex[];
  edges: GraphEdge[];
}

export interface ClientSettings {
  voiceEnabled: boolean;
  autoSpeak: boolean;
}

export interface ChatSession {
  schemaVersion: number;
  domainId: DomainId;
  messages: ChatMessage[];
  graph: GraphState;
  settings: ClientSettings;
  interview?: InterviewState;
  audit: AuditFinding[];
}

export interface ChatRequest {
  domainId: DomainId;
  messages: ChatMessage[];
  graph: GraphState;
  interview?: InterviewState;
  audit?: AuditFinding[];
}

export interface ChatResponse {
  assistantMessage: ChatMessage;
  delta: GraphDelta;
  warnings: string[];
  interview?: InterviewState;
  audit?: AuditFinding[];
}

import { emptyGraph } from "./schema";
import { getDomain, isDomainId } from "./domains";
import type { ChatSession, DomainId } from "./types";

// Keep the original database name so existing hospitality sessions resume.
const DB_NAME = "cognisee-hospitality-browser";
const DB_VERSION = 1;
const STORE_NAME = "sessions";
const SESSION_KEY = "default";
const SESSION_SCHEMA_VERSION = 2;

export function defaultSession(domainId: DomainId = "headache"): ChatSession {
  const domain = getDomain(domainId);
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    domainId,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: domain.openingLine,
        createdAt: Date.now()
      }
    ],
    graph: emptyGraph(domainId),
    settings: {
      voiceEnabled: true,
      autoSpeak: true
    }
  };
}

export async function loadSession(): Promise<ChatSession> {
  const db = await openDb();
  const value = await requestToPromise<ChatSession | undefined>(
    db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(SESSION_KEY)
  );
  db.close();
  if (!value) return defaultSession();
  if (isDomainId(value.domainId)) {
    if (value.domainId === "hospitality" && value.schemaVersion !== SESSION_SCHEMA_VERSION) {
      return migrateHospitalityIntro(value);
    }
    return { ...value, schemaVersion: SESSION_SCHEMA_VERSION };
  }
  // Migrate sessions created by the former hospitality-only browser app.
  return migrateHospitalityIntro({ ...value, domainId: "hospitality" });
}

function migrateHospitalityIntro(session: ChatSession): ChatSession {
  const graph = emptyGraph("hospitality");
  const section = Object.values(graph.vertices).find(
    (vertex) => vertex.label === "SessionSection"
  );
  const knowledgeSession = Object.values(graph.vertices).find(
    (vertex) => vertex.label === "KnowledgeSession"
  );
  if (section && knowledgeSession) {
    session.messages
      .filter((message) => message.role === "user" && message.content.trim())
      .forEach((message, index) => {
        const episodeId = `ep:${knowledgeSession.id}:${String(index + 1).padStart(2, "0")}`;
        graph.vertices[episodeId] = {
          id: episodeId,
          label: "TranscriptEpisode",
          properties: {
            verbatimText: message.content,
            speaker: "expert"
          }
        };
        const edgeId = `${section.id}-hasEpisode->${episodeId}`;
        graph.edges[edgeId] = {
          id: edgeId,
          label: "hasEpisode",
          out: section.id,
          in: episodeId,
          properties: {}
        };
      });
  }
  return {
    ...session,
    schemaVersion: SESSION_SCHEMA_VERSION,
    domainId: "hospitality",
    graph
  };
}

export async function saveSession(session: ChatSession): Promise<void> {
  const db = await openDb();
  await requestToPromise(
    db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(session, SESSION_KEY)
  );
  db.close();
}

export async function clearSession(domainId: DomainId = "headache"): Promise<ChatSession> {
  const session = defaultSession(domainId);
  await saveSession(session);
  return session;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Download,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Play,
  RotateCcw,
  Send,
  Square,
  Volume2,
  VolumeX
} from "lucide-react";
import { GraphView } from "@/components/GraphView";
import { DOMAIN_OPTIONS, getDomain } from "@/lib/domains";
import { exportSessionJson, exportTranscriptJsonl, exportTranscriptTxt } from "@/lib/export";
import { OpenAIRealtimeSession, type RealtimeStatus } from "@/lib/realtime";
import { mergeDelta } from "@/lib/schema";
import { clearSession, loadSession, saveSession } from "@/lib/storage";
import { createSpeechRecognition, speak, speechRecognitionAvailable, stopSpeaking } from "@/lib/speech";
import type { ChatMessage, ChatResponse, ChatSession, DomainId } from "@/lib/types";

export default function Home() {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("idle");
  const [warnings, setWarnings] = useState<string[]>([]);
  const recognitionRef = useRef<ReturnType<typeof createSpeechRecognition>>(null);
  const realtimeRef = useRef<OpenAIRealtimeSession | null>(null);
  const sessionRef = useRef<ChatSession | null>(null);
  const openingAudioAttemptedRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSpeechAvailable(speechRecognitionAvailable());
    void loadSession().then(setSession);
  }, []);

  useEffect(() => {
    if (session) void saveSession(session);
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const opening = session?.messages[0];
    if (
      !session ||
      !opening ||
      session.messages.some((message) => message.role === "user") ||
      !session.settings.autoSpeak ||
      openingAudioAttemptedRef.current === opening.id
    ) {
      return;
    }
    openingAudioAttemptedRef.current = opening.id;
    void speak(opening.content).then((voice) => {
      if (!voice.ok && voice.error) {
        setWarnings((current) => [
          ...current.filter((item) => item !== voice.error),
          voice.error!
        ]);
      }
    });
  }, [session]);

  useEffect(() => () => realtimeRef.current?.stop(), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages.length]);

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !session || isSending) return;
    setInput("");
    setWarnings([]);
    setIsSending(true);

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      createdAt: Date.now()
    };
    const optimistic = {
      ...session,
      messages: [...session.messages, userMessage]
    };
    setSession(optimistic);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: optimistic.messages,
          graph: optimistic.graph,
          domainId: optimistic.domainId
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as ChatResponse;
      const nextGraph = mergeDelta(optimistic.graph, data.delta);
      setSession({
        ...optimistic,
        graph: nextGraph,
        messages: [...optimistic.messages, data.assistantMessage]
      });
      setWarnings(data.warnings ?? []);
      if (optimistic.settings.autoSpeak) {
        const voice = await speak(data.assistantMessage.content);
        if (!voice.ok && voice.error) {
          setWarnings((current) => [...current, voice.error!]);
        }
      }
    } catch {
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "I couldn't reach the assistant service. Please try again in a moment.",
        createdAt: Date.now()
      };
      setSession({
        ...optimistic,
        messages: [...optimistic.messages, assistantMessage]
      });
    } finally {
      setIsSending(false);
    }
  }

  function appendMessage(role: ChatMessage["role"], content: string): ChatSession | null {
    const current = sessionRef.current;
    if (!current) return null;
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role,
      content,
      createdAt: Date.now()
    };
    const next = {
      ...current,
      messages: [...current.messages, message]
    };
    sessionRef.current = next;
    setSession(next);
    return next;
  }

  async function extractVoiceTurn(text: string, baseSession: ChatSession) {
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          messages: baseSession.messages,
          graph: baseSession.graph,
          domainId: baseSession.domainId
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as Pick<ChatResponse, "delta" | "warnings">;
      const current = sessionRef.current;
      if (!current) return;
      const next = {
        ...current,
        graph: mergeDelta(current.graph, data.delta)
      };
      sessionRef.current = next;
      setSession(next);
      setWarnings(data.warnings ?? []);
    } catch {
      setWarnings(["Voice transcript saved, but graph extraction failed for that turn."]);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(input);
  }

  function toggleListening() {
    if (!speechAvailable || !session) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    stopSpeaking();
    const recognition = createSpeechRecognition(
      (text) => {
        setInput(text);
        void submit(text);
      },
      () => setIsListening(false)
    );
    recognitionRef.current = recognition;
    recognition?.start();
    setIsListening(Boolean(recognition));
  }

  function toggleAutoSpeak() {
    if (!session) return;
    stopSpeaking();
    setSession({
      ...session,
      settings: {
        ...session.settings,
        autoSpeak: !session.settings.autoSpeak
      }
    });
  }

  async function playMessage(text: string) {
    const voice = await speak(text);
    if (!voice.ok && voice.error) {
      setWarnings((current) => [...current.filter((item) => item !== voice.error), voice.error!]);
    }
  }

  async function toggleRealtime() {
    if (realtimeStatus !== "idle") {
      realtimeRef.current?.stop();
      realtimeRef.current = null;
      return;
    }
    stopSpeaking();
    recognitionRef.current?.stop();
    setIsListening(false);
    setWarnings([]);

    if (!session) return;
    if (!session.messages.some((message) => message.role === "user")) {
      await playMessage(session.messages[0]?.content ?? getDomain(session.domainId).openingLine);
    }
    const realtime = new OpenAIRealtimeSession(
      {
        onStatus: setRealtimeStatus,
        onError: (message) => setWarnings([message]),
        onUserTranscript: (text) => {
          const next = appendMessage("user", text);
          if (next) void extractVoiceTurn(text, next);
        },
        onAssistantTranscript: (text) => {
          appendMessage("assistant", text);
        }
      },
      session.domainId
    );
    realtimeRef.current = realtime;
    await realtime.start();
  }

  async function reset() {
    realtimeRef.current?.stop();
    realtimeRef.current = null;
    stopSpeaking();
    setWarnings([]);
    setInput("");
    const next = await clearSession(session?.domainId ?? "headache");
    openingAudioAttemptedRef.current = next.messages[0].id;
    setSession(next);
    if (next.settings.autoSpeak) await playMessage(next.messages[0].content);
  }

  async function selectDomain(domainId: DomainId) {
    if (!session || session.messages.some((message) => message.role === "user")) return;
    realtimeRef.current?.stop();
    realtimeRef.current = null;
    stopSpeaking();
    setWarnings([]);
    setInput("");
    const next = await clearSession(domainId);
    openingAudioAttemptedRef.current = next.messages[0].id;
    setSession(next);
    if (next.settings.autoSpeak) await playMessage(next.messages[0].content);
  }

  function exportAll() {
    if (!session) return;
    exportTranscriptTxt(session);
    exportTranscriptJsonl(session);
    exportSessionJson(session);
  }

  if (!session) {
    return (
      <main className="app-frame">
        <div className="loading-panel">Loading chatgraph…</div>
      </main>
    );
  }
  const domain = getDomain(session.domainId);
  const sessionStarted = session.messages.some((message) => message.role === "user");
  const activeSection = Object.values(session.graph.vertices)
    .filter((vertex) => vertex.label === "SessionSection")
    .sort((a, b) => Number(b.properties.order ?? 0) - Number(a.properties.order ?? 0))[0];

  return (
    <main className="app-frame">
      <section className="workspace">
        <div className="conversation-pane">
          <header className="topbar">
            <div>
              <div className="title-row">
                <h1>Cognisee</h1>
                <label className="domain-picker">
                  <span>Domain</span>
                  <select
                    value={session.domainId}
                    onChange={(event) => void selectDomain(event.target.value as DomainId)}
                    disabled={sessionStarted || isSending || realtimeStatus !== "idle"}
                    aria-label="Interview domain"
                    title={sessionStarted ? "Reset the session before changing domain" : "Interview domain"}
                  >
                    {DOMAIN_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p>
                Cognisee · {domain.roleDescription}
                {realtimeStatus !== "idle" ? ` · voice ${realtimeStatus}` : ""}
                {!sessionStarted && realtimeStatus === "idle" ? " · opening audio ready" : ""}
              </p>
            </div>
            <div className="toolbar">
              <button
                type="button"
                className="icon-button"
                onClick={toggleRealtime}
                disabled={isSending}
                title={realtimeStatus === "idle" ? "Start OpenAI live voice" : "Stop OpenAI live voice"}
                aria-label={realtimeStatus === "idle" ? "Start OpenAI live voice" : "Stop OpenAI live voice"}
              >
                {realtimeStatus === "idle" ? <PhoneCall size={18} /> : <PhoneOff size={18} />}
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={toggleAutoSpeak}
                title={session.settings.autoSpeak ? "Mute replies" : "Speak replies"}
                aria-label={session.settings.autoSpeak ? "Mute replies" : "Speak replies"}
              >
                {session.settings.autoSpeak ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={toggleListening}
                disabled={!speechAvailable || isSending}
                title={isListening ? "Stop listening" : "Start listening"}
                aria-label={isListening ? "Stop listening" : "Start listening"}
              >
                {isListening ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={exportAll}
                title="Download transcript and graph"
                aria-label="Download transcript and graph"
              >
                <Download size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={reset}
                title="Reset session"
                aria-label="Reset session"
              >
                <RotateCcw size={18} />
              </button>
            </div>
          </header>

          <div className="message-list">
            {session.messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <div className="message-meta">
                  <span>{message.role === "assistant" ? "Cognisee" : domain.participantLabel}</span>
                  {message.role === "assistant" && (
                    <button
                      type="button"
                      className="message-audio"
                      onClick={() => void playMessage(message.content)}
                      title="Play this reply"
                      aria-label="Play this reply"
                    >
                      <Play size={13} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <p>{message.content}</p>
              </article>
            ))}
            {isSending && (
              <article className="message assistant pending">
                <span>Cognisee</span>
                <p>Mapping the answer…</p>
              </article>
            )}
            <div ref={bottomRef} />
          </div>

          {warnings.length > 0 && (
            <div className="warning-strip">
              {warnings.slice(0, 2).map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          )}

          <form className="composer" onSubmit={onSubmit}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={domain.composerPlaceholder}
              aria-label={`${domain.label} ${domain.participantLabel} response`}
              rows={2}
              disabled={isSending}
            />
            <button
              type="submit"
              className="send-button"
              disabled={!input.trim() || isSending}
              title="Send"
              aria-label="Send"
            >
              {isSending ? <Square size={18} /> : <Send size={18} />}
            </button>
          </form>
        </div>

        <aside className="graph-pane">
          <header className="graph-header">
            <div>
              <h2>{domain.label} knowledge graph</h2>
              <p>
                Schema: {domain.schemaPath}
                {activeSection ? ` · Section ${activeSection.properties.order}: ${activeSection.properties.title}` : ""}
              </p>
            </div>
          </header>
          <GraphView graph={session.graph} domainLabel={domain.label} />
        </aside>
      </section>
    </main>
  );
}

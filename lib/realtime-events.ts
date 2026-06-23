export type RealtimeTranscript = {
  role: "user" | "assistant";
  text: string;
  sourceId: string;
};

export type RealtimeServerEvent = {
  type?: string;
  event_id?: string;
  item_id?: string;
  response_id?: string;
  delta?: string;
  transcript?: string;
  text?: string;
  error?: { message?: string };
  response?: {
    id?: string;
    status?: string;
    output?: RealtimeOutputItem[];
  };
};

type RealtimeOutputItem = {
  id?: string;
  role?: string;
  type?: string;
  content?: Array<{
    transcript?: string;
    text?: string;
  }>;
};

export class RealtimeTranscriptCollector {
  private assistantBuffers = new Map<string, string>();
  private deliveredUserItems = new Set<string>();
  private deliveredAssistantItems = new Set<string>();

  collect(event: RealtimeServerEvent): RealtimeTranscript[] {
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const text = event.transcript?.trim();
      const sourceId = event.item_id ?? event.event_id;
      if (!text || !sourceId || this.deliveredUserItems.has(sourceId)) return [];
      this.deliveredUserItems.add(sourceId);
      return [{ role: "user", text, sourceId: `realtime:user:${sourceId}` }];
    }

    if (
      event.type === "response.output_audio_transcript.delta" ||
      event.type === "response.output_text.delta"
    ) {
      const itemId = event.item_id ?? event.response_id;
      if (itemId && event.delta) {
        this.assistantBuffers.set(
          itemId,
          `${this.assistantBuffers.get(itemId) ?? ""}${event.delta}`
        );
      }
      return [];
    }

    if (
      event.type === "response.output_audio_transcript.done" ||
      event.type === "response.output_text.done"
    ) {
      const itemId = event.item_id ?? event.response_id ?? event.event_id;
      if (!itemId) return [];
      const text = (
        event.transcript ??
        event.text ??
        this.assistantBuffers.get(itemId) ??
        ""
      ).trim();
      this.assistantBuffers.delete(itemId);
      return this.deliverAssistant(itemId, text);
    }

    if (event.type === "response.done") {
      const response = event.response;
      if (!response) return [];
      if (response.status && response.status !== "completed") return [];
      const transcripts: RealtimeTranscript[] = [];
      for (const output of response.output ?? []) {
        if (output.type && output.type !== "message") continue;
        if (output.role && output.role !== "assistant") continue;
        const itemId = output.id ?? response.id ?? event.event_id;
        if (!itemId) continue;
        const text = extractOutputText(output).trim();
        transcripts.push(...this.deliverAssistant(itemId, text));
      }
      return transcripts;
    }

    return [];
  }

  reset(): void {
    this.assistantBuffers.clear();
    this.deliveredUserItems.clear();
    this.deliveredAssistantItems.clear();
  }

  private deliverAssistant(itemId: string, text: string): RealtimeTranscript[] {
    if (!text || this.deliveredAssistantItems.has(itemId)) return [];
    this.deliveredAssistantItems.add(itemId);
    return [{
      role: "assistant",
      text,
      sourceId: `realtime:assistant:${itemId}`
    }];
  }
}

function extractOutputText(output: RealtimeOutputItem): string {
  const pieces: string[] = [];
  for (const content of output.content ?? []) {
    if (content.transcript) pieces.push(content.transcript);
    else if (content.text) pieces.push(content.text);
  }
  return pieces.join(" ");
}

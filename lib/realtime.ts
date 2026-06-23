import {
  RealtimeTranscriptCollector,
  type RealtimeServerEvent
} from "./realtime-events";

export type RealtimeStatus = "idle" | "connecting" | "connected";

type RealtimeCallbacks = {
  onStatus: (status: RealtimeStatus) => void;
  onUserTranscript: (text: string, sourceId: string) => void;
  onAssistantTranscript: (text: string, sourceId: string) => void;
  onError: (message: string) => void;
};

export class OpenAIRealtimeSession {
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private transcriptCollector = new RealtimeTranscriptCollector();
  private stopped = true;

  constructor(
    private callbacks: RealtimeCallbacks,
    private domainId: string
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.callbacks.onStatus("connecting");
    try {
      const tokenResponse = await fetch(
        `/api/realtime/token?domain=${encodeURIComponent(this.domainId)}`,
        { cache: "no-store" }
      );
      if (!tokenResponse.ok) throw new Error(await tokenResponse.text());
      const tokenPayload = await tokenResponse.json();
      const token = extractRealtimeToken(tokenPayload);
      if (!token) throw new Error("Realtime token response did not include a client secret.");
      if (this.stopped) return;

      const peer = new RTCPeerConnection();
      this.peer = peer;

      this.audio = document.createElement("audio");
      this.audio.autoplay = true;
      peer.ontrack = (event) => {
        if (this.audio) this.audio.srcObject = event.streams[0];
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      if (this.stopped) {
        stream.getTracks().forEach((track) => track.stop());
        peer.close();
        return;
      }
      this.stream = stream;
      for (const track of stream.getTracks()) peer.addTrack(track, stream);

      this.channel = peer.createDataChannel("oai-events");
      this.channel.addEventListener("open", () => this.callbacks.onStatus("connected"));
      this.channel.addEventListener("message", (event) => this.handleEvent(event.data));
      this.channel.addEventListener("close", () => this.callbacks.onStatus("idle"));

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/sdp"
        }
      });
      if (!sdpResponse.ok) throw new Error(await sdpResponse.text());
      if (this.stopped) return;
      await peer.setRemoteDescription({
        type: "answer",
        sdp: await sdpResponse.text()
      });
    } catch (error) {
      if (this.stopped) return;
      this.stop();
      this.callbacks.onError(error instanceof Error ? error.message : "Realtime voice failed.");
    }
  }

  stop(): void {
    this.stopped = true;
    this.channel?.close();
    this.peer?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.audio) this.audio.srcObject = null;
    this.channel = null;
    this.peer = null;
    this.stream = null;
    this.audio = null;
    this.transcriptCollector.reset();
    this.callbacks.onStatus("idle");
  }

  updateInstructions(instructions: string): void {
    if (!instructions || this.channel?.readyState !== "open") return;
    this.channel.send(
      JSON.stringify({
        type: "session.update",
        session: { instructions }
      })
    );
  }

  private handleEvent(raw: string): void {
    let event: RealtimeServerEvent;
    try {
      event = JSON.parse(raw) as RealtimeServerEvent;
    } catch {
      return;
    }

    if (event.type === "error") {
      this.callbacks.onError(event.error?.message ?? "Realtime API returned an error.");
      return;
    }

    for (const transcript of this.transcriptCollector.collect(event)) {
      if (transcript.role === "user") {
        this.callbacks.onUserTranscript(transcript.text, transcript.sourceId);
      } else {
        this.callbacks.onAssistantTranscript(transcript.text, transcript.sourceId);
      }
    }
  }
}

function extractRealtimeToken(payload: unknown): string {
  if (!isRecord(payload)) return "";
  if (typeof payload.value === "string") return payload.value;
  const clientSecret = payload.client_secret;
  if (isRecord(clientSecret) && typeof clientSecret.value === "string") {
    return clientSecret.value;
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

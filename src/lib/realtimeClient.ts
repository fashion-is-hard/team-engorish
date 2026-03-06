// src/lib/realtimeClient.ts

export type RealtimeServerEvent = {
  type: string;
  [key: string]: any;
};

export type RealtimeClientOptions = {
  tokenEndpoint: string;
  sessionPayload: Record<string, any>;
  onEvent?: (event: RealtimeServerEvent) => void;
  onError?: (message: string) => void;
  onRemoteAudioStart?: () => void;
  onRemoteAudioStop?: () => void;
};

function waitForIceGatheringComplete(pc: RTCPeerConnection) {
  return new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }

    const handler = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", handler);
        resolve();
      }
    };

    pc.addEventListener("icegatheringstatechange", handler);
  });
}

export class RealtimeVoiceClient {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private micTrack: MediaStreamTrack | null = null;
  private remoteAudioEl: HTMLAudioElement | null = null;
  private connected = false;
  private opts: RealtimeClientOptions;

  constructor(opts: RealtimeClientOptions) {
    this.opts = opts;
  }

  isConnected() {
    return this.connected;
  }

  async connect() {
    if (this.connected) return;

    const tokenRes = await fetch(this.opts.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.opts.sessionPayload),
    });

    const tokenJson = await tokenRes.json();

    if (!tokenRes.ok || !tokenJson?.value) {
      throw new Error(tokenJson?.error ?? "Failed to get realtime token");
    }

    const ephemeralKey = tokenJson.value;

    const pc = new RTCPeerConnection();
    this.pc = pc;

    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    (audioEl as any).playsInline = true;
    audioEl.style.display = "none";
    document.body.appendChild(audioEl);
    this.remoteAudioEl = audioEl;

    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
    };

    audioEl.onplaying = () => this.opts.onRemoteAudioStart?.();
    audioEl.onpause = () => this.opts.onRemoteAudioStop?.();
    audioEl.onended = () => this.opts.onRemoteAudioStop?.();
    audioEl.onerror = () => this.opts.onRemoteAudioStop?.();

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.micTrack = this.localStream.getAudioTracks()[0];
    this.micTrack.enabled = false;

    pc.addTrack(this.micTrack, this.localStream);

    this.dc = pc.createDataChannel("oai-events");
    this.dc.addEventListener("message", (e) => {
      try {
        const event = JSON.parse(e.data);
        this.opts.onEvent?.(event);
      } catch {
        // ignore
      }
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: pc.localDescription?.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp",
      },
    });

    const answerSdp = await sdpRes.text();

    if (!sdpRes.ok) {
      throw new Error(answerSdp || "Failed to connect realtime call");
    }

    await pc.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });

         // ✅ 세션 상세 설정은 연결 후 session.update 로 보냄
    const sessionUpdateEvent = {
      type: "session.update",
      session: {
        type: "realtime",
        model: "gpt-realtime",
        output_modalities: ["audio", "text"],
        instructions:
          typeof this.opts.sessionPayload?.instructions === "string"
            ? this.opts.sessionPayload.instructions
            : "You are a helpful voice conversation partner.",
        audio: {
          input: {
            turn_detection: {
              type: "server_vad",
              create_response: true,
            },
          },
          output: {
            voice: this.opts.sessionPayload?.voice ?? "marin",
          },
        },
      },
    };

    this.sendEvent(sessionUpdateEvent);

    this.connected = true;
  }

  startMic() {
    if (this.micTrack) {
      this.micTrack.enabled = true;
    }
  }

  stopMic() {
    if (this.micTrack) {
      this.micTrack.enabled = false;
    }
  }

  sendEvent(event: Record<string, any>) {
    if (!this.dc || this.dc.readyState !== "open") return;
    this.dc.send(JSON.stringify(event));
  }

  close() {
    try {
      this.stopMic();
    } catch {}

    try {
      this.dc?.close();
    } catch {}

    try {
      this.pc?.close();
    } catch {}

    try {
      this.localStream?.getTracks().forEach((t) => t.stop());
    } catch {}

    try {
      if (this.remoteAudioEl) {
        this.remoteAudioEl.pause();
        this.remoteAudioEl.srcObject = null;
        this.remoteAudioEl.remove();
      }
    } catch {}

    this.remoteAudioEl = null;
    this.localStream = null;
    this.micTrack = null;
    this.dc = null;
    this.pc = null;
    this.connected = false;
  }
}

export function extractRealtimeAssistantText(event: RealtimeServerEvent): string | null {
  if (event?.type === "response.done") {
    const outputs = event?.response?.output;
    if (Array.isArray(outputs)) {
      const parts: string[] = [];

      for (const item of outputs) {
        const content = item?.content;
        if (Array.isArray(content)) {
          for (const c of content) {
            if (typeof c?.transcript === "string" && c.transcript.trim()) {
              parts.push(c.transcript.trim());
            }
            if (typeof c?.text === "string" && c.text.trim()) {
              parts.push(c.text.trim());
            }
          }
        }
      }

      if (parts.length > 0) {
        return parts.join(" ").trim();
      }
    }
  }

  if (event?.type === "response.audio_transcript.done" && typeof event?.transcript === "string") {
    return event.transcript.trim();
  }

  if (event?.type === "response.output_text.done" && typeof event?.text === "string") {
    return event.text.trim();
  }

  return null;
}

export function extractRealtimeUserText(event: RealtimeServerEvent): string | null {
  if (
    event?.type === "conversation.item.input_audio_transcription.completed" &&
    typeof event?.transcript === "string"
  ) {
    return event.transcript.trim();
  }

  if (event?.type === "input_audio_buffer.transcript.done" && typeof event?.transcript === "string") {
    return event.transcript.trim();
  }

  return null;
}
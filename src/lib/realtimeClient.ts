// src/lib/realtimeClient.ts
console.log("REALTIME CLIENT VERSION 2");

export type RealtimeServerEvent = {
  type: string;
  [key: string]: any;
};

export type RealtimeClientOptions = {
  tokenEndpoint: string;
  sessionPayload: Record<string, any>;
  tokenHeaders?: Record<string, string>;
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

  private emitError(message: string) {
    console.error("[RealtimeVoiceClient]", message);
    this.opts.onError?.(message);
  }

  async connect() {
    if (this.connected) return;

    const tokenRes = await fetch(this.opts.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.opts.tokenHeaders ?? {}),
      },
      body: JSON.stringify(this.opts.sessionPayload),
    });

    const raw = await tokenRes.text();
    console.log("realtime_session raw:", raw, "status:", tokenRes.status);

    let tokenJson: any = null;
    try {
      tokenJson = JSON.parse(raw);
    } catch {
      tokenJson = { raw };
    }

    const ephemeralKey =
      tokenJson?.value ??
      tokenJson?.client_secret?.value ??
      null;

    console.log("ephemeralKey exists:", !!ephemeralKey);

    if (!ephemeralKey) {
      const detail =
        tokenJson?.detail ??
        tokenJson?.error ??
        tokenJson?.raw ??
        "Failed to get realtime token";
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }

    console.log("Realtime token acquired");

    const pc = new RTCPeerConnection();
    this.pc = pc;

    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    (audioEl as any).playsInline = true;
    audioEl.style.display = "none";
    document.body.appendChild(audioEl);
    this.remoteAudioEl = audioEl;

    pc.ontrack = (e) => {
      console.log("pc.ontrack");
      audioEl.srcObject = e.streams[0];
    };

    audioEl.onplaying = () => {
      console.log("remote audio playing");
      this.opts.onRemoteAudioStart?.();
    };
    audioEl.onpause = () => {
      console.log("remote audio paused");
      this.opts.onRemoteAudioStop?.();
    };
    audioEl.onended = () => {
      console.log("remote audio ended");
      this.opts.onRemoteAudioStop?.();
    };
    audioEl.onerror = () => {
      console.log("remote audio error");
      this.opts.onRemoteAudioStop?.();
    };

    pc.onconnectionstatechange = () => {
      console.log("pc.connectionState:", pc.connectionState);
      if (pc.connectionState === "failed") {
        this.emitError("WebRTC connection failed");
      }
      if (pc.connectionState === "disconnected" || pc.connectionState === "closed") {
        this.opts.onRemoteAudioStop?.();
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("pc.iceConnectionState:", pc.iceConnectionState);
      if (pc.iceConnectionState === "failed") {
        this.emitError("ICE connection failed");
      }
    };

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.micTrack = this.localStream.getAudioTracks()[0];
    this.micTrack.enabled = false;

    pc.addTrack(this.micTrack, this.localStream);

    this.dc = pc.createDataChannel("oai-events");

    this.dc.addEventListener("open", () => {
      console.log("Realtime data channel open");

      const sessionUpdateEvent = {
        type: "session.update",
        session: {
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
              voice: this.opts.sessionPayload?.voice ?? "alloy",
            },
          },
        },
      };

      console.log("sending session.update", sessionUpdateEvent);
      this.sendEvent(sessionUpdateEvent);
    });

    this.dc.addEventListener("message", (e) => {
      try {
        const event = JSON.parse(e.data);
        console.log("realtime event:", event);
        this.opts.onEvent?.(event);
      } catch (err) {
        this.emitError(`Failed to parse realtime event: ${String(err)}`);
      }
    });

    this.dc.addEventListener("error", () => {
      this.emitError("Realtime data channel error");
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    const sdp = pc.localDescription?.sdp;
    if (!sdp) {
      throw new Error("Missing local SDP offer");
    }

    const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      body: sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp",
      },
    });

    const answerSdp = await sdpRes.text();
    console.log("realtime calls status:", sdpRes.status);

    if (!sdpRes.ok) {
      throw new Error(answerSdp || "Failed to connect realtime call");
    }

    await pc.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });

    this.connected = true;
    console.log("Realtime connected");
  }

  startMic() {
    if (this.micTrack) {
      this.micTrack.enabled = true;
      console.log("mic enabled");
    }
  }

  stopMic() {
    if (this.micTrack) {
      this.micTrack.enabled = false;
      console.log("mic disabled");
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

      if (parts.length > 0) return parts.join(" ").trim();
    }
  }

  if (event?.type === "response.audio_transcript.done" && typeof event?.transcript === "string") {
    return event.transcript.trim();
  }

  if (event?.type === "response.output_text.done" && typeof event?.text === "string") {
    return event.text.trim();
  }

  if (
    event?.type === "response.content_part.done" &&
    (typeof event?.part?.transcript === "string" || typeof event?.part?.text === "string")
  ) {
    return String(event?.part?.transcript ?? event?.part?.text ?? "").trim() || null;
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

  if (
    event?.type === "conversation.item.created" &&
    event?.item?.role === "user" &&
    Array.isArray(event?.item?.content)
  ) {
    for (const c of event.item.content) {
      if (typeof c?.transcript === "string" && c.transcript.trim()) {
        return c.transcript.trim();
      }
      if (typeof c?.text === "string" && c.text.trim()) {
        return c.text.trim();
      }
    }
  }

  return null;
}
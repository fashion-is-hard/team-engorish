import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./PlayPage.module.css";

type Difficulty = "basic" | "intermediate";
type CorrectionMode = "correct" | "suggest";
type DbVariant = "A" | "B";
type VariantPath = "a" | "b";

type PlayStatus =
  | "booting"
  | "ai-speaking"
  | "idle"
  | "recording"
  | "transcribing"
  | "thinking"
  | "error";

type ChatItem = {
  id: string;
  role: "assistant" | "user";
  text: string;
  correction?: string | null;
  audioUrl?: string | null;
  createdAt: number;
};

type ScenarioRow = {
  scenario_id: string;
  package_id: string;
  title: string;
  scenario_desc: string | null;
  is_active: boolean;
};

type ScenarioGoalRow = {
  goal_id: string;
  scenario_id: string;
  goal_title: string;
  goal_type: string;
  goal_definition: unknown;
  success_threshold: number | null;
  version: number;
  is_active: boolean;
  created_at: string;
};

type ScenarioNpcRow = {
  npc_id: string;
  scenario_id: string;
  role_name: string;
  role_desc: string | null;
  avatar_url: string | null;
  sort_order: number | null;
};

type ProfileRow = {
  id: string;
  ab_variant: DbVariant;
};

type ChatTextResponse = {
  ai_text: string;
  correction: string | null;
};

type ChatTtsResponse = {
  tts_audio_url: string | null;
  tts_error?: string | null;
};

type SttResponse = {
  text: string;
};

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function mmss(totalSec: number) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

export default function PlayPage() {
  const navigate = useNavigate();
  const { scenarioId = "" } = useParams();

  const [status, setStatus] = useState<PlayStatus>("booting");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ScenarioRow | null>(null);
  const [npc, setNpc] = useState<ScenarioNpcRow | null>(null);
  const [goals, setGoals] = useState<ScenarioGoalRow[]>([]);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [variant, setVariant] = useState<DbVariant>("A");

  const correctionMode: CorrectionMode = "suggest";
  const difficulty: Difficulty = "basic";
  const questionSpeed = 1.0;
  const ttsVoice = "alloy";

  const timerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const messagesRef = useRef<ChatItem[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const titleText = useMemo(() => {
    return scenario?.title || "시나리오 명";
  }, [scenario]);

  const statusText = useMemo(() => {
    switch (status) {
      case "booting":
        return "대화를 준비하고 있어요";
      case "ai-speaking":
        return "AI가 말하고 있어요";
      case "idle":
        return "버튼을 누르고 대화를 시작해주세요";
      case "recording":
        return "듣고 있어요. 말이 끝나면 다시 버튼을 눌러주세요.";
      case "transcribing":
        return "음성을 텍스트로 변환하고 있어요";
      case "thinking":
        return "응답을 기다리고 있어요";
      case "error":
        return errorText || "오류가 발생했어요";
      default:
        return "";
    }
  }, [status, errorText]);

  const micDisabled =
    status === "booting" ||
    status === "ai-speaking" ||
    status === "transcribing" ||
    status === "thinking";

  useEffect(() => {
    void init();

    return () => {
      stopTimer();
      stopAudio();
      cleanupRecording();
    };
  }, []);

  function startTimer() {
    stopTimer();
    timerRef.current = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
  }

  function cleanupRecording() {
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  async function init() {
    try {
      setStatus("booting");
      setErrorText(null);

      if (!scenarioId) {
        throw new Error("scenarioId가 없습니다.");
      }

      const user = await getCurrentUser();
      const profile = await fetchProfile(user.id);

      setVariant(profile.ab_variant ?? "A");

      const [scenarioData, goalData, npcData] = await Promise.all([
        fetchScenario(scenarioId),
        fetchGoals(scenarioId),
        fetchNpc(scenarioId),
      ]);

      setScenario(scenarioData);
      setGoals(goalData);
      setNpc(npcData);

      const createdSessionId = await createSession({
        userId: user.id,
        variant: profile.ab_variant ?? "A",
        packageId: scenarioData.package_id,
        scenarioId: scenarioData.scenario_id,
      });

      setSessionId(createdSessionId);
      startTimer();

      const firstReply = await requestAiReply({
        sessionId: createdSessionId,
        userText:
          "Start the conversation naturally with the first line only. Ask one short question to begin.",
        scenarioTitle: scenarioData.title || "Scenario",
        scenarioDesc: scenarioData.scenario_desc || "",
        npcRoleName: npcData?.role_name || "NPC",
        npcRoleDesc: npcData?.role_desc || "",
      });

      const firstAiMessage: ChatItem = {
        id: uid("msg"),
        role: "assistant",
        text: firstReply.ai_text,
        correction: firstReply.correction,
        audioUrl: null,
        createdAt: Date.now(),
      };

      setMessages([firstAiMessage]);

      const ttsAudioUrl = await requestTts(createdSessionId, firstReply.ai_text);
      if (ttsAudioUrl) {
        setMessages((prev) =>
          prev.map((m, idx) =>
            idx === 0 ? { ...m, audioUrl: ttsAudioUrl } : m
          )
        );
      }

      await saveTurn({
        sessionId: createdSessionId,
        role: "ai",
        textRaw: firstReply.ai_text,
        textCorrected: null,
        audioUrl: ttsAudioUrl,
      });

      if (ttsAudioUrl) {
        await playAudio(ttsAudioUrl);
      }

      setStatus("idle");
    } catch (error) {
      console.error(error);
      setErrorText(error instanceof Error ? error.message : "초기화에 실패했습니다.");
      setStatus("error");
    }
  }

  async function getCurrentUser() {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      throw new Error("로그인 정보가 없습니다.");
    }

    return user;
  }

  async function fetchProfile(userId: string): Promise<ProfileRow> {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, ab_variant")
      .eq("id", userId)
      .single();

    if (error) throw error;
    return data as ProfileRow;
  }

  async function fetchScenario(id: string): Promise<ScenarioRow> {
    const { data, error } = await supabase
      .from("scenarios")
      .select("scenario_id, package_id, title, scenario_desc, is_active")
      .eq("scenario_id", id)
      .single();

    if (error) throw error;
    return data as ScenarioRow;
  }

  async function fetchGoals(id: string): Promise<ScenarioGoalRow[]> {
    const { data, error } = await supabase
      .from("scenario_goals")
      .select("*")
      .eq("scenario_id", id)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("goal fetch error:", error);
      return [];
    }

    return (data ?? []) as ScenarioGoalRow[];
  }

  async function fetchNpc(id: string): Promise<ScenarioNpcRow | null> {
    const { data, error } = await supabase
      .from("scenario_npcs")
      .select("*")
      .eq("scenario_id", id)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .limit(1);

    if (error) {
      console.warn("npc fetch error:", error);
      return null;
    }

    return data?.[0] ? (data[0] as ScenarioNpcRow) : null;
  }

  async function createSession(params: {
    userId: string;
    variant: DbVariant;
    packageId: string;
    scenarioId: string;
  }): Promise<string> {
    const { data, error } = await supabase
      .from("roleplay_sessions")
      .insert({
        user_id: params.userId,
        variant: params.variant,
        package_id: params.packageId,
        scenario_id: params.scenarioId,
        started_at: new Date().toISOString(),
        status: "active",
        turn_limit: 20,
        turn_count_user: 0,
        turn_count_ai: 0,
        platform: "web",
        model_name: "gpt-4.1-mini",
      })
      .select("session_id")
      .single();

    if (error) throw error;
    return data.session_id as string;
  }

  async function saveTurn(params: {
    sessionId: string;
    role: "user" | "ai";
    textRaw: string;
    textCorrected?: string | null;
    audioUrl?: string | null;
    latencyMs?: number | null;
  }) {
    const currentMessages = messagesRef.current;
    const turnNo = currentMessages.length + 1;

    const { error } = await supabase.from("roleplay_turns").insert({
      session_id: params.sessionId,
      turn_no: turnNo,
      role: params.role,
      text_raw: params.textRaw,
      text_corrected: params.textCorrected ?? null,
      audio_url: params.audioUrl ?? null,
      latency_ms: params.latencyMs ?? null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("saveTurn error:", error);
    }

    if (params.role === "user") {
      await supabase
        .from("roleplay_sessions")
        .update({ turn_count_user: countRole(currentMessages, "user") + 1 })
        .eq("session_id", params.sessionId);
    } else {
      await supabase
        .from("roleplay_sessions")
        .update({ turn_count_ai: countRole(currentMessages, "assistant") + 1 })
        .eq("session_id", params.sessionId);
    }
  }

  function countRole(list: ChatItem[], role: "assistant" | "user") {
    return list.filter((m) => m.role === role).length;
  }

  async function requestAiReply(params: {
    sessionId: string;
    userText: string;
    scenarioTitle: string;
    scenarioDesc: string;
    npcRoleName: string;
    npcRoleDesc: string;
  }): Promise<ChatTextResponse & { _latencyMs: number }> {
    const startedAt = performance.now();

    const { data, error } = await supabase.functions.invoke("chat_text", {
      body: {
        sessionId: params.sessionId,
        userText: params.userText,
        mode: correctionMode,
        difficulty,
        questionSpeed,
        scenarioTitle: params.scenarioTitle,
        scenarioDesc: params.scenarioDesc,
        npcRoleName: params.npcRoleName,
        npcRoleDesc: params.npcRoleDesc,
      },
    });

    if (error) {
      throw new Error(error.message || "chat_text 호출 실패");
    }

    return {
      ...(data as ChatTextResponse),
      _latencyMs: Math.round(performance.now() - startedAt),
    };
  }

  async function requestTts(currentSessionId: string, text: string): Promise<string | null> {
    const { data, error } = await supabase.functions.invoke("chat_tts", {
      body: {
        sessionId: currentSessionId,
        text,
        voice: ttsVoice,
      },
    });

    if (error) {
      console.error("chat_tts error:", error);
      return null;
    }

    const result = data as ChatTtsResponse;
    return result.tts_audio_url ?? null;
  }

  async function requestStt(audioBlob: Blob): Promise<SttResponse> {
    const session = await supabase.auth.getSession();
    const accessToken = session.data.session?.access_token;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const functionsUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stt`;

    const formData = new FormData();
    formData.append("file", audioBlob, "recording.webm");

    const res = await fetch(functionsUrl, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken ?? anonKey}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "stt 호출 실패");
    }

    return (await res.json()) as SttResponse;
  }

  async function playAudio(audioUrl: string) {
    setStatus("ai-speaking");

    await new Promise<void>((resolve, reject) => {
      try {
        stopAudio();

        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("오디오 재생 실패"));

        void audio.play();
      } catch (error) {
        reject(error);
      }
    });
  }

  async function startRecording() {
    if (status !== "idle") return;

    try {
      setErrorText(null);
      stopAudio();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.start();
      setStatus("recording");
    } catch (error) {
      console.error(error);
      setErrorText("마이크 권한이 필요합니다.");
      setStatus("error");
    }
  }

  async function stopRecordingAndSend() {
    if (status !== "recording" || !mediaRecorderRef.current || !sessionId || !scenario) return;

    try {
      const recorder = mediaRecorderRef.current;

      const audioBlob = await new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          try {
            resolve(new Blob(chunksRef.current, { type: "audio/webm" }));
          } catch (error) {
            reject(error);
          }
        };

        recorder.onerror = () => reject(new Error("녹음 종료 실패"));
        recorder.stop();
      });

      cleanupRecording();

      setStatus("transcribing");
      const stt = await requestStt(audioBlob);
      const userText = stt.text?.trim();

      if (!userText) {
        setErrorText("음성이 인식되지 않았어요. 다시 시도해주세요.");
        setStatus("error");
        return;
      }

      const userMessage: ChatItem = {
        id: uid("msg"),
        role: "user",
        text: userText,
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);

      await saveTurn({
        sessionId,
        role: "user",
        textRaw: userText,
      });

      setStatus("thinking");

      const reply = await requestAiReply({
        sessionId,
        userText,
        scenarioTitle: scenario.title || "Scenario",
        scenarioDesc: scenario.scenario_desc || "",
        npcRoleName: npc?.role_name || "NPC",
        npcRoleDesc: npc?.role_desc || "",
      });

      const ttsAudioUrl = await requestTts(sessionId, reply.ai_text);

      const aiMessage: ChatItem = {
        id: uid("msg"),
        role: "assistant",
        text: reply.ai_text,
        correction: reply.correction,
        audioUrl: ttsAudioUrl,
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, aiMessage]);

      await saveTurn({
        sessionId,
        role: "ai",
        textRaw: reply.ai_text,
        textCorrected: reply.correction,
        audioUrl: ttsAudioUrl,
        latencyMs: reply._latencyMs,
      });

      if (ttsAudioUrl) {
        await playAudio(ttsAudioUrl);
      }

      setStatus("idle");
    } catch (error) {
      console.error(error);
      setErrorText(error instanceof Error ? error.message : "응답 처리에 실패했습니다.");
      setStatus("error");
    }
  }

  async function handleMicClick() {
    if (status === "idle") {
      await startRecording();
      return;
    }

    if (status === "recording") {
      await stopRecordingAndSend();
      return;
    }

    if (status === "error") {
      setErrorText(null);
      setStatus("idle");
    }
  }

  async function handleExit() {
    stopTimer();
    stopAudio();
    cleanupRecording();

    if (sessionId) {
      await supabase
        .from("roleplay_sessions")
        .update({
          ended_at: new Date().toISOString(),
          end_reason: "exit",
          status: "ended",
          duration_sec: elapsedSec,
        })
        .eq("session_id", sessionId);
    }

    const pathVariant: VariantPath = variant === "B" ? "b" : "a";
    navigate(`/${pathVariant}/home`);
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.headerTitle}>{titleText}</div>
          <div className={styles.timer}>{mmss(elapsedSec)}</div>
          <button type="button" className={styles.closeButton} onClick={handleExit}>
            ×
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.goalCard}>
          <div className={styles.goalTitle}>목표</div>
          <div className={styles.goalBody}>
            {goals.length > 0 ? (
              goals.map((goal) => (
                <div key={goal.goal_id} className={styles.goalItem}>
                  <span className={styles.goalCheck}>☑</span>
                  <span>{goal.goal_title}</span>
                </div>
              ))
            ) : (
              <div className={styles.goalItem}>등록된 목표가 없습니다.</div>
            )}
          </div>
        </section>

        <section className={styles.chatArea}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`${styles.bubbleRow} ${
                msg.role === "assistant" ? styles.left : styles.right
              }`}
            >
              <div
                className={`${styles.bubble} ${
                  msg.role === "assistant" ? styles.assistantBubble : styles.userBubble
                }`}
              >
                <div>{msg.text}</div>
                {msg.role === "user" && msg.correction ? (
                  <div className={styles.correction}>{msg.correction}</div>
                ) : null}
              </div>
            </div>
          ))}
        </section>

        <div className={styles.bottomArea}>
          <div className={styles.statusText}>{statusText}</div>

          <button
            type="button"
            className={`${styles.micButton} ${
              status === "recording" ? styles.micRecording : ""
            }`}
            onClick={handleMicClick}
            disabled={micDisabled}
          >
            {status === "recording" ? "■" : "🎤"}
          </button>
        </div>
      </main>
    </div>
  );
}
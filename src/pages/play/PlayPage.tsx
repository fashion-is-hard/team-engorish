import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./PlayPage.module.css";

type VariantPath = "a" | "b";

type ChatItem = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

type GoalState = {
  goal_id: string;
  goal_title: string;
  goal_definition: any;
  achieved: boolean;
};

type ScenarioRow = {
  scenario_id: string;
  title: string;
  scenario_desc: string | null;
  first_chat: string | null;
};


type SpeechRecognitionCtor = new () => SpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }

  interface SpeechRecognition extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
    onerror: ((this: SpeechRecognition, ev: any) => any) | null;
    onend: ((this: SpeechRecognition, ev: Event) => any) | null;
    start(): void;
    stop(): void;
  }

  interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
    resultIndex: number;
  }
}

const A_TURN_LIMIT = 20;

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function mmss(totalSec: number) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

function toChatHistory(list: ChatItem[]) {
  return list.map((m) => ({
    role: m.role,
    text: m.text,
  }));
}

export default function PlayPage() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const variant: VariantPath = location.pathname.startsWith("/b") ? "b" : "a";
  const isA = variant === "a";
  const basePath = `/${variant}`;

  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [goals, setGoals] = useState<GoalState[]>([]);
  const [scenarioTitle, setScenarioTitle] = useState("");
  const [scenarioDesc, setScenarioDesc] = useState("");
  const [npcRole, setNpcRole] = useState("");
  const [npcDesc, setNpcDesc] = useState("");
  const [firstChatText, setFirstChatText] = useState("");

  const [status, setStatus] = useState<
    "booting" | "idle" | "recording" | "thinking" | "ai-speaking"
  >("booting");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [speechSupported, setSpeechSupported] = useState(false);
  const [startModalOpen, setStartModalOpen] = useState(true);
  const [readyForStart, setReadyForStart] = useState(false);

  const [elapsedSec, setElapsedSec] = useState(0);
  const [userTurnCount, setUserTurnCount] = useState(0);
  const [aiTurnCount, setAiTurnCount] = useState(0);
  void aiTurnCount;

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finishedRef = useRef(false);
  const messagesRef = useRef<ChatItem[]>([]);
  const startedAtRef = useRef<number>(Date.now());
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    void init();
    setupSpeechRecognition();

    return () => {
      recognitionRef.current?.stop();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      stopTimer();
    };
  }, []);

  const aProgressCount = useMemo(() => {
    return Math.min(userTurnCount, A_TURN_LIMIT);
  }, [userTurnCount]);

  const aProgressPercent = useMemo(() => {
    return (aProgressCount / A_TURN_LIMIT) * 100;
  }, [aProgressCount]);

  function startTimer() {
    stopTimer();
    timerRef.current = window.setInterval(() => {
      setElapsedSec(Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)));
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function setupSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SR) {
      setSpeechSupported(false);
      return;
    }

    setSpeechSupported(true);

    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setLiveTranscript(transcript.trim());
    };

    recognition.onerror = (event) => {
      console.error("speech recognition error:", event);
    };

    recognitionRef.current = recognition;
  }

  async function getCurrentTurnNo() {
    const { count, error } = await supabase
      .from("roleplay_turns")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId);

    if (error) {
      console.error("getCurrentTurnNo error:", error);
      return 0;
    }

    return count ?? 0;
  }

  async function syncTurnCounts() {
    const { data, error } = await supabase
      .from("roleplay_turns")
      .select("role")
      .eq("session_id", sessionId);

    if (error) {
      console.error("syncTurnCounts error:", error);
      return;
    }

    const rows = data ?? [];
    const nextUserCount = rows.filter((r: any) => r.role === "user").length;
    const nextAiCount = rows.filter((r: any) => r.role === "ai").length;

    setUserTurnCount(nextUserCount);
    setAiTurnCount(nextAiCount);

    const { error: updateError } = await supabase
      .from("roleplay_sessions")
      .update({
        turn_count_user: nextUserCount,
        turn_count_ai: nextAiCount,
      })
      .eq("session_id", sessionId);

    if (updateError) {
      console.error("syncTurnCounts update error:", updateError);
    }
  }

  async function saveTurn(params: {
    role: "ai" | "user";
    textRaw: string;
    textCorrected?: string | null;
    audioUrl?: string | null;
  }) {
    const turnNo = (await getCurrentTurnNo()) + 1;

    const { error } = await supabase.from("roleplay_turns").insert({
      session_id: sessionId,
      turn_no: turnNo,
      role: params.role,
      text_raw: params.textRaw,
      text_corrected: params.textCorrected ?? null,
      audio_url: params.audioUrl ?? null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("saveTurn error:", error);
      return;
    }

    await syncTurnCounts();
  }

  async function uploadUserAudio(blob: Blob) {
    try {
      const filePath = `session_${sessionId}/user_${Date.now()}_${crypto.randomUUID()}.webm`;

      const { error } = await supabase.storage.from("audio").upload(filePath, blob, {
        contentType: "audio/webm",
        upsert: true,
      });

      if (error) {
        console.error("uploadUserAudio error:", error);
        return null;
      }

      const { data } = supabase.storage.from("audio").getPublicUrl(filePath);
      return data?.publicUrl ?? null;
    } catch (error) {
      console.error("uploadUserAudio unexpected error:", error);
      return null;
    }
  }

  async function markSessionEnded(params: {
    endReason: string;
    isSuccess: boolean;
  }) {
    const durationSec = Math.max(
      0,
      Math.round((Date.now() - startedAtRef.current) / 1000)
    );

    const { error } = await supabase
      .from("roleplay_sessions")
      .update({
        ended_at: new Date().toISOString(),
        status: "ended",
        end_reason: params.endReason,
        is_success: params.isSuccess,
        duration_sec: durationSec,
      })
      .eq("session_id", sessionId);

    if (error) {
      console.error("markSessionEnded error:", error);
    }
  }

  async function init() {
    try {
      const { data: session, error: sessionError } = await supabase
        .from("roleplay_sessions")
        .select("scenario_id, started_at, turn_count_user, turn_count_ai")
        .eq("session_id", sessionId)
        .single();

      if (sessionError || !session?.scenario_id) {
        console.error("session fetch error:", sessionError);
        setStatus("idle");
        return;
      }

      if (session.started_at) {
        startedAtRef.current = new Date(session.started_at).getTime();
        setElapsedSec(Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)));
        startTimer();
      }

      setUserTurnCount(session.turn_count_user ?? 0);
      setAiTurnCount(session.turn_count_ai ?? 0);

      const scenarioId = session.scenario_id;

      const scenarioSelect = isA
        ? "scenario_id, title, scenario_desc, first_chat"
        : "scenario_id, title, scenario_desc, first_chat";

      const [{ data: scenario, error: scenarioError }, { data: goalData }, { data: npcData }] =
        await Promise.all([
          supabase.from("scenarios").select(scenarioSelect).eq("scenario_id", scenarioId).single(),
          supabase
            .from("scenario_goals")
            .select("goal_id, goal_title, goal_definition")
            .eq("scenario_id", scenarioId)
            .order("created_at", { ascending: true }),
          supabase
            .from("scenario_npcs")
            .select("role_name, role_desc")
            .eq("scenario_id", scenarioId)
            .limit(1),
        ]);

      if (scenarioError || !scenario) {
        console.error("scenario fetch error:", scenarioError);
        setStatus("idle");
        return;
      }

      const scenarioRow = scenario as ScenarioRow;

      setScenarioTitle(scenarioRow.title ?? "시나리오 명");
      setScenarioDesc(scenarioRow.scenario_desc ?? "");

      if (npcData?.length) {
        setNpcRole(npcData[0].role_name ?? "");
        setNpcDesc(npcData[0].role_desc ?? "");
      }

      if (!isA) {
        setGoals(
          (goalData ?? []).map((g: any) => ({
            goal_id: g.goal_id,
            goal_title: g.goal_title,
            goal_definition: g.goal_definition,
            achieved: false,
          }))
        );
      } else {
        setGoals([]);
      }

      const firstChat =
        typeof scenarioRow.first_chat === "string" && scenarioRow.first_chat.trim()
          ? scenarioRow.first_chat.trim()
          : "Hello, what brings you here?";

      setFirstChatText(firstChat);

      const firstMessage: ChatItem = {
        id: uid(),
        role: "assistant",
        text: firstChat,
      };

      setMessages([firstMessage]);
      setReadyForStart(true);
      setStatus("booting");

      const { count } = await supabase
        .from("roleplay_turns")
        .select("*", { count: "exact", head: true })
        .eq("session_id", sessionId);

      if ((count ?? 0) === 0) {
        await saveTurn({
          role: "ai",
          textRaw: firstChat,
          audioUrl: null,
        });
      }
    } catch (error) {
      console.error("init error:", error);
      setStatus("idle");
    }
  }

  async function playFirstChat() {
    if (!firstChatText.trim()) {
      setStatus("idle");
      return;
    }

    try {
      setStatus("ai-speaking");

      const tts = await supabase.functions.invoke("chat_tts", {
        body: {
          sessionId,
          text: firstChatText,
          voice: "alloy",
        },
      });

      if (tts.error) {
        console.error("chat_tts error:", tts.error);
        setStatus("idle");
        return;
      }

      const audioUrl = tts.data?.tts_audio_url ?? null;

      if (!audioUrl) {
        setStatus("idle");
        return;
      }

      const { data: firstTurn } = await supabase
        .from("roleplay_turns")
        .select("turn_id")
        .eq("session_id", sessionId)
        .eq("turn_no", 1)
        .single();

      if (firstTurn?.turn_id) {
        await supabase
          .from("roleplay_turns")
          .update({ audio_url: audioUrl })
          .eq("turn_id", firstTurn.turn_id);
      }

      const audio = new Audio(audioUrl);
      audio.onended = () => {
        setStatus("idle");
      };

      await audio.play();
    } catch (error) {
      console.error("playFirstChat error:", error);
      setStatus("idle");
    }
  }

  async function handleStartConfirm() {
    setStartModalOpen(false);
    await playFirstChat();
  }

  async function startRecording() {
    try {
      setLiveTranscript("");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          await handleSpeech(blob);
        } finally {
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
          }
        }
      };

      recorder.start();

      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch (error) {
          console.warn("speech recognition start skipped:", error);
        }
      }

      setStatus("recording");
    } catch (error) {
      console.error("startRecording error:", error);
      setStatus("idle");
    }
  }

  async function stopRecording() {
    recognitionRef.current?.stop();
    mediaRecorderRef.current?.stop();
    setStatus("thinking");
  }

  async function handleSpeech(blob: Blob) {
    try {
      const userAudioUrl = await uploadUserAudio(blob);

      const form = new FormData();
      form.append("file", blob, "recording.webm");

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const sttRes = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stt`, {
        method: "POST",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${
            session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY
          }`,
        },
        body: form,
      });

      if (!sttRes.ok) {
        const text = await sttRes.text();
        throw new Error(text || "stt 호출 실패");
      }

      const sttJson = await sttRes.json();
      const userText = (sttJson?.text ?? "").trim();

      setLiveTranscript("");

      if (!userText) {
        setStatus("idle");
        return;
      }

      const userMsg: ChatItem = {
        id: uid(),
        role: "user",
        text: userText,
      };

      const historyBeforeReply = [...messagesRef.current, userMsg];
      setMessages(historyBeforeReply);

      await saveTurn({
        role: "user",
        textRaw: userText,
        audioUrl: userAudioUrl,
      });

      if (!isA) {
        const shouldFinish = await checkGoals(userText, historyBeforeReply);
        if (shouldFinish) {
          return;
        }
      }

      const chatRes = await supabase.functions.invoke("chat", {
        body: {
          sessionId,
          userText,
          mode: "suggest",
          difficulty: "basic",
          questionSpeed: 1.0,
          scenarioTitle,
          scenarioDesc,
          npcRoleName: npcRole || "NPC",
          npcRoleDesc: npcDesc || "",
          messages: toChatHistory(historyBeforeReply),
          isClosing: false,
        },
      });

      if (chatRes.error) {
        console.error("chat invoke error:", chatRes.error);
        setStatus("idle");
        return;
      }

      const aiText = chatRes.data?.ai_text ?? "Sorry, could you say that again?";
      const ttsAudioUrl = chatRes.data?.tts_audio_url ?? null;
      const correction = chatRes.data?.correction ?? null;

      const aiMsg: ChatItem = {
        id: uid(),
        role: "assistant",
        text: aiText,
      };

      setMessages((prev) => [...prev, aiMsg]);

      await saveTurn({
        role: "ai",
        textRaw: aiText,
        textCorrected: correction,
        audioUrl: ttsAudioUrl,
      });

      if (ttsAudioUrl) {
        setStatus("ai-speaking");

        const audio = new Audio(ttsAudioUrl);
        audio.onended = async () => {
          if (isA) {
            const nextUserTurns = userTurnCount + 1;
            if (nextUserTurns >= A_TURN_LIMIT && !finishedRef.current) {
              finishedRef.current = true;
              await finishSessionA("turn_limit");
              return;
            }
          }
          setStatus("idle");
        };

        await audio.play();
      } else {
        if (isA) {
          const nextUserTurns = userTurnCount + 1;
          if (nextUserTurns >= A_TURN_LIMIT && !finishedRef.current) {
            finishedRef.current = true;
            await finishSessionA("turn_limit");
            return;
          }
        }
        setStatus("idle");
      }
    } catch (error) {
      console.error("handleSpeech error:", error);
      setLiveTranscript("");
      setStatus("idle");
    }
  }

  async function checkGoals(userText: string, historyBeforeReply: ChatItem[]): Promise<boolean> {
    try {
      const res = await supabase.functions.invoke("goal_check", {
        body: {
          userText,
          goals: goals.map((g) => ({
            goal_id: g.goal_id,
            goal_title: g.goal_title,
            goal_definition: g.goal_definition,
          })),
        },
      });

      if (res.error) {
        console.error("goal_check error:", res.error);
        return false;
      }

      const achievedIds: string[] = Array.isArray(res.data?.achieved_goal_ids)
        ? res.data.achieved_goal_ids
        : [];

      const updatedGoals = goals.map((goal) =>
        achievedIds.includes(goal.goal_id) ? { ...goal, achieved: true } : goal
      );

      setGoals(updatedGoals);

      const doneCount = updatedGoals.filter((g) => g.achieved).length;

      if (doneCount >= 3 && !finishedRef.current) {
        finishedRef.current = true;
        await finishConversationB(historyBeforeReply);
        return true;
      }

      return false;
    } catch (error) {
      console.error("checkGoals error:", error);
      return false;
    }
  }

  async function finishConversationB(history: ChatItem[]) {
    try {
      const chat = await supabase.functions.invoke("chat", {
        body: {
          sessionId,
          userText: "Please end this conversation naturally.",
          scenarioTitle,
          scenarioDesc,
          npcRoleName: npcRole || "NPC",
          npcRoleDesc: npcDesc || "",
          mode: "suggest",
          difficulty: "basic",
          questionSpeed: 1.0,
          messages: toChatHistory(history),
          isClosing: true,
        },
      });

      const text = chat.data?.ai_text ?? "Thanks for talking with me. Goodbye!";
      const audioUrl = chat.data?.tts_audio_url ?? null;
      const correction = chat.data?.correction ?? null;

      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text,
        },
      ]);

      await saveTurn({
        role: "ai",
        textRaw: text,
        textCorrected: correction,
        audioUrl,
      });

      await markSessionEnded({
        endReason: "goals_done",
        isSuccess: true,
      });

      if (audioUrl) {
        setStatus("ai-speaking");

        const audio = new Audio(audioUrl);
        audio.onended = () => {
          navigate(`${basePath}/result/${sessionId}`);
        };

        await audio.play();
      } else {
        navigate(`${basePath}/result/${sessionId}`);
      }
    } catch (error) {
      console.error("finishConversationB error:", error);
      navigate(`${basePath}/result/${sessionId}`);
    }
  }

  async function finishSessionA(endReason: string) {
    await markSessionEnded({
      endReason,
      isSuccess: true,
    });
    navigate(`${basePath}/result/${sessionId}`);
  }

  async function handleExit() {
    if (finishedRef.current) return;
    finishedRef.current = true;

    stopTimer();

    await markSessionEnded({
      endReason: "exit",
      isSuccess: isA ? true : false,
    });

    navigate(`${basePath}/result/${sessionId}`);
  }

  function handleMic() {
    if (startModalOpen || !readyForStart) return;

    if (status === "idle") {
      void startRecording();
      return;
    }

    if (status === "recording") {
      void stopRecording();
    }
  }

  return (
    <div className={styles.container}>
      {startModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalTitle}>대화가 곧 시작됩니다.</div>
            <div className={styles.modalText}>
              스피커와 마이크 연결을 확인해주세요.
            </div>
            <button
              className={styles.modalButton}
              type="button"
              onClick={handleStartConfirm}
              disabled={!readyForStart}
            >
              확인
            </button>
          </div>
        </div>
      )}

      {isA ? (
        <>
          <div className={styles.playHeaderA}>
            <div className={styles.playTitle}>{scenarioTitle || "시나리오 명"}</div>
            <div className={styles.playTimer}>{mmss(elapsedSec)}</div>
            <button className={styles.playClose} onClick={handleExit} type="button">
              ✕
            </button>
          </div>

          <div className={styles.progressWrap}>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${aProgressPercent}%` }} />
            </div>
            <div className={styles.progressText}>
              {pad2(aProgressCount)}/{A_TURN_LIMIT}
            </div>
          </div>

          <div className={styles.scenarioCard}>
            <div className={styles.scenarioCardTitle}>시나리오 설명</div>
            <div className={styles.scenarioCardBody}>{scenarioDesc || "설명 문장"}</div>
          </div>
        </>
      ) : (
        <>
          <header className={styles.header}>
            <div>{scenarioTitle}</div>
            <button className={styles.playCloseB} onClick={handleExit} type="button">
              ✕
            </button>
          </header>

          <div className={styles.goalCard}>
            {goals.map((g) => (
              <div key={g.goal_id}>
                {g.achieved ? "✅" : "⬜"} {g.goal_title}
              </div>
            ))}
          </div>
        </>
      )}

      <div className={styles.chatArea}>
        {messages.map((m) => (
          <div key={m.id} className={m.role === "assistant" ? styles.left : styles.right}>
            <div
              className={`${styles.bubble} ${
                m.role === "assistant" ? styles.assistantBubble : styles.userBubble
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}

        {status === "recording" && liveTranscript && (
          <div className={styles.right}>
            <div className={`${styles.bubble} ${styles.userBubble} ${styles.liveBubble}`}>
              {liveTranscript}
            </div>
          </div>
        )}
      </div>

      <div className={styles.bottom}>
        <div className={styles.status}>
          {startModalOpen
            ? "확인 버튼을 누르면 대화가 시작됩니다."
            : status === "recording"
            ? "듣고 있어요. 말하는 내용이 실시간으로 표시됩니다."
            : status === "thinking"
            ? "응답을 기다리고 있어요"
            : status === "ai-speaking"
            ? "AI가 말하고 있어요"
            : "말을 시작할 때 버튼을 눌러주세요"}
          {!speechSupported && status === "idle"
            ? " (실시간 전사는 일부 브라우저에서만 지원)"
            : ""}
        </div>

        <button
          className={styles.mic}
          onClick={handleMic}
          disabled={startModalOpen || status === "thinking" || status === "ai-speaking"}
          type="button"
        >
          🎤
        </button>
      </div>
    </div>
  );
}
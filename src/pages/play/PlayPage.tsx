import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./PlayPage.module.css";

type VariantPath = "a" | "b";
function normalizeVariant(v: unknown): VariantPath {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "b" ? "b" : "a";
}

type PlayState = "idle" | "listening" | "processing";

type Msg = {
  id: string;
  role: "ai" | "user";
  text: string;
  createdAt: number;
  correctedText?: string | null;
  translatedText?: string | null;
  audioUrl?: string | null;
  canAutoplay?: boolean;
};

type SessionRow = {
  session_id: string;
  user_id: string;
  variant: string;
  package_id: string | null;
  scenario_id: string | null;
  started_at: string;
  ended_at: string | null;
  status: string;
  end_reason: string | null;
  turn_limit: number | null;
  turn_count_user: number;
  turn_count_ai: number;
};

type SettingsRow = {
  session_id: string;
  correction_mode: "correct" | "suggest";
  difficulty: "basic" | "intermediate";
  question_speed: number;
};

type ScenarioRow = {
  scenario_id: string;
  package_id: string;
  title: string;
  scenario_desc: string | null;
  thumb_url: string | null;
};

type NpcRow = {
  npc_id: string;
  scenario_id: string;
  role_name: string;
  role_desc: string | null;
  avatar_url: string | null;
  sort_order: number | null;
};

type DbTurn = {
  turn_id: string;
  session_id: string;
  turn_no: number;
  role: string;
  text_raw: string | null;
  text_corrected: string | null;
  text_translated: string | null;
  audio_url: string | null;
  created_at: string;
};

type ScenarioGoalRow = {
  goal_id: string;
  scenario_id: string;
  goal_title: string;
  goal_type: string;
  goal_definition: any;
  success_threshold: number | null;
  version: number | null;
  is_active: boolean;
  created_at: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: null | (() => void);
  onend: null | (() => void);
  onerror: null | ((e: any) => void);
  onresult: null | ((e: any) => void);
  start: () => void;
  stop: () => void;
};

function getSpeechRecognitionCtor(): any {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function isMobileDevice() {
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod/i.test(ua);
}

function isIOS() {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua);
}

function supportsSpeechRecognition() {
  return !!getSpeechRecognitionCtor();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function mmss(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

export default function PlayPage() {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();

  const pathVariant: VariantPath = location.pathname.startsWith("/b") ? "b" : "a";
  const sessionId = (params as any).sessionId as string | undefined;

  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);

  const [playState, setPlayState] = useState<PlayState>("idle");
  const [messages, setMessages] = useState<Msg[]>([]);

  const [session, setSession] = useState<SessionRow | null>(null);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [scenario, setScenario] = useState<ScenarioRow | null>(null);
  const [npc, setNpc] = useState<NpcRow | null>(null);

  const variant: VariantPath = normalizeVariant(session?.variant ?? pathVariant);
  const isB = variant === "b";

  const [elapsedSec, setElapsedSec] = useState(0);
  const [hasUserStarted, setHasUserStarted] = useState(false);

  const [goals, setGoals] = useState<ScenarioGoalRow[]>([]);
  const [checkedGoalIds, setCheckedGoalIds] = useState<Record<string, boolean>>({});

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef<string>("");
  const listeningStartedAtRef = useRef<number>(0);
  const [interimText, setInterimText] = useState<string>("");

  const [speechSupported, setSpeechSupported] = useState(true);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isAiVoicePending, setIsAiVoicePending] = useState(false);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const audioUnlockedRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const endingRef = useRef(false);
  const startHandledRef = useRef(false);

  const turnLimit = useMemo(() => session?.turn_limit ?? 20, [session?.turn_limit]);

  const pairTurnsNow = useMemo(() => {
    const u = session?.turn_count_user ?? 0;
    const a = session?.turn_count_ai ?? 0;
    return Math.min(u, a);
  }, [session?.turn_count_user, session?.turn_count_ai]);

  const progressRatio = useMemo(() => {
    if (isB) return 0;
    return Math.min(1, pairTurnsNow / Math.max(1, turnLimit));
  }, [isB, pairTurnsNow, turnLimit]);

  const goalsDone = useMemo(() => {
    if (!isB) return false;
    if (goals.length === 0) return false;
    return goals.every((g) => checkedGoalIds[g.goal_id]);
  }, [isB, goals, checkedGoalIds]);

  const goalsCount = goals.length;
  const goalsCheckedCount = useMemo(
    () => goals.filter((g) => checkedGoalIds[g.goal_id]).length,
    [goals, checkedGoalIds]
  );

  useEffect(() => {
    setSpeechSupported(supportsSpeechRecognition());
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (session?.status === "active") setElapsedSec((v) => v + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [session?.status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, interimText]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {}
      try {
        currentAudioRef.current?.pause();
        currentAudioRef.current = null;
      } catch {}
      if (endTimerRef.current) window.clearTimeout(endTimerRef.current);
    };
  }, []);

  function wait(ms: number) {
    return new Promise<void>((resolve) => {
      endTimerRef.current = window.setTimeout(() => resolve(), ms);
    });
  }

  async function waitForAudioEnd(maxMs = 15000) {
    const a = currentAudioRef.current;
    if (!a) return;
    if (a.paused || a.ended) return;

    await new Promise<void>((resolve) => {
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        a.removeEventListener("ended", finish);
        a.removeEventListener("pause", finish);
        resolve();
      };

      a.addEventListener("ended", finish, { once: true });
      a.addEventListener("pause", finish, { once: true });
      window.setTimeout(() => finish(), maxMs);
    });
  }

  async function getNextTurnNo(): Promise<number> {
    if (!sessionId) return 1;

    const { data, error } = await supabase
      .from("roleplay_turns")
      .select("turn_no")
      .eq("session_id", sessionId)
      .order("turn_no", { ascending: false })
      .limit(1);

    if (error) return (messages?.length ?? 0) + 1;
    return (data?.[0]?.turn_no ?? 0) + 1;
  }

  function attachAudioLifecycle(a: HTMLAudioElement) {
    a.onplay = () => setIsAiSpeaking(true);
    a.onended = () => setIsAiSpeaking(false);
    a.onpause = () => setIsAiSpeaking(false);
    a.onerror = () => setIsAiSpeaking(false);
  }

  function stopAnyAudio() {
    try {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
      }
    } catch {}
    currentAudioRef.current = null;
    setIsAiSpeaking(false);
  }

  async function tryAutoplay(url: string): Promise<boolean> {
    try {
      stopAnyAudio();
      const a = new Audio(url);
      a.preload = "auto";
      (a as any).playsInline = true;
      attachAudioLifecycle(a);
      currentAudioRef.current = a;
      await a.play();
      return true;
    } catch {
      setIsAiSpeaking(false);
      return false;
    }
  }

  async function unlockAudioOnce() {
    if (audioUnlockedRef.current) return;

    const SILENT_WAV =
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

    try {
      const a = new Audio(SILENT_WAV);
      a.muted = true;
      (a as any).playsInline = true;
      await a.play();
      a.pause();
      audioUnlockedRef.current = true;
    } catch {}
  }

  async function endSession(reason: "user_exit" | "turn_limit" | "goals_done") {
    if (!sessionId) return;
    if (endingRef.current) return;
    endingRef.current = true;

    const isUserExit = reason === "user_exit";

    try {
      try {
        recognitionRef.current?.stop();
      } catch {}

      if (!isUserExit) {
        await waitForAudioEnd(15000);
        await wait(3000);
      } else {
        stopAnyAudio();
      }

      await supabase
        .from("roleplay_sessions")
        .update({ status: "ended", ended_at: new Date().toISOString(), end_reason: reason })
        .eq("session_id", sessionId);

      setSession((prev) =>
        prev ? { ...prev, status: "ended", ended_at: new Date().toISOString(), end_reason: reason } : prev
      );
    } finally {
      navigate(`/${variant}/result/${sessionId}`);
    }
  }

  async function checkGoalsWithEdge(args: {
    sessionId: string;
    scenarioId: string;
    userText: string;
    aiText: string;
    goals: ScenarioGoalRow[];
  }): Promise<{ achieved_goal_ids: string[] }> {
    const { data: sess } = await supabase.auth.getSession();
    const accessToken = sess.session?.access_token;

    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/goal_check`;

    const payload = {
      sessionId: args.sessionId,
      scenarioId: args.scenarioId,
      userText: args.userText,
      aiText: args.aiText,
      goals: args.goals.map((g) => ({
        goal_id: g.goal_id,
        goal_title: g.goal_title,
        goal_type: g.goal_type,
        goal_definition: g.goal_definition,
        success_threshold: g.success_threshold,
      })),
    };

    const res = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      throw new Error(`goal_check ${res.status}: ${JSON.stringify(json)}`);
    }

    return json as { achieved_goal_ids: string[] };
  }

  async function generateAiTextWithEdge(userText: string) {
    const payload = {
      sessionId,
      userText,
      mode: settings?.correction_mode ?? "suggest",
      difficulty: settings?.difficulty ?? "basic",
      questionSpeed: settings?.question_speed ?? 1.0,
      scenarioTitle: scenario?.title ?? "Scenario",
      scenarioDesc: scenario?.scenario_desc ?? "",
      npcRoleName: npc?.role_name ?? "NPC",
      npcRoleDesc: npc?.role_desc ?? "",
    };

    const { data: sess } = await supabase.auth.getSession();
    const accessToken = sess.session?.access_token;

    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat_text`;

    const res = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      throw new Error(`chat_text ${res.status}: ${JSON.stringify(json)}`);
    }

    return json as {
      ai_text: string;
      correction: string | null;
    };
  }

  async function generateTtsWithEdge(text: string) {
    const { data: sess } = await supabase.auth.getSession();
    const accessToken = sess.session?.access_token;

    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat_tts`;

    const res = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        sessionId,
        text,
        voice: "alloy",
      }),
    });

    const raw = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(raw);
    } catch {
      json = { raw };
    }

    if (!res.ok) {
      throw new Error(`chat_tts ${res.status}: ${JSON.stringify(json)}`);
    }

    return json as {
      tts_audio_url: string | null;
    };
  }

  useEffect(() => {
    if (!sessionId) return;

    (async () => {
      setLoading(true);
      setFatal(null);

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        navigate("/auth/login");
        return;
      }

      const { data: sData, error: sErr } = await supabase
        .from("roleplay_sessions")
        .select("*")
        .eq("session_id", sessionId)
        .single();

      if (sErr) {
        setFatal(sErr.message);
        setLoading(false);
        return;
      }

      const sess = sData as SessionRow;
      setSession(sess);

      if (!sess.scenario_id) {
        setFatal("세션에 scenario_id가 없습니다.");
        setLoading(false);
        return;
      }

      const { data: scData, error: scErr } = await supabase
        .from("scenarios")
        .select("scenario_id,package_id,title,scenario_desc,thumb_url")
        .eq("scenario_id", sess.scenario_id)
        .single();

      if (scErr) {
        setFatal(scErr.message);
        setLoading(false);
        return;
      }
      const sc = scData as ScenarioRow;
      setScenario(sc);

      const { data: npcData } = await supabase
        .from("scenario_npcs")
        .select("npc_id,scenario_id,role_name,role_desc,avatar_url,sort_order")
        .eq("scenario_id", sc.scenario_id)
        .order("sort_order", { ascending: true })
        .limit(1);
      setNpc(npcData && npcData.length > 0 ? (npcData[0] as NpcRow) : null);

      const { data: setData } = await supabase
        .from("session_settings")
        .select("session_id,correction_mode,difficulty,question_speed")
        .eq("session_id", sessionId)
        .maybeSingle();
      if (setData) setSettings(setData as SettingsRow);

      const { data: tData, error: tErr } = await supabase
        .from("roleplay_turns")
        .select("turn_id,session_id,turn_no,role,text_raw,text_corrected,text_translated,audio_url,created_at")
        .eq("session_id", sessionId)
        .order("turn_no", { ascending: true });

      if (tErr) {
        setFatal(tErr.message);
        setLoading(false);
        return;
      }

      const turns = (tData ?? []) as DbTurn[];
      const msgs: Msg[] = turns.map((t) => ({
        id: t.turn_id,
        role: t.role === "assistant" || t.role === "ai" ? "ai" : "user",
        text: t.text_raw ?? "",
        correctedText: t.text_corrected,
        translatedText: t.text_translated,
        audioUrl: t.audio_url ?? null,
        canAutoplay: t.audio_url ? true : false,
        createdAt: new Date(t.created_at).getTime(),
      }));
      setMessages(msgs);
      setHasUserStarted(msgs.some((m) => m.role === "user" && m.text.trim().length > 0));

      const effectiveVariant = normalizeVariant(sess.variant ?? pathVariant);
      if (effectiveVariant === "b") {
        const { data: gData, error: gErr } = await supabase
          .from("scenario_goals")
          .select(
            "goal_id,scenario_id,goal_title,goal_type,goal_definition,success_threshold,version,is_active,created_at"
          )
          .eq("scenario_id", sc.scenario_id)
          .eq("is_active", true)
          .order("created_at", { ascending: true });

        if (gErr) {
          setFatal(gErr.message);
          setLoading(false);
          return;
        }

        const gList = (gData ?? []) as ScenarioGoalRow[];
        setGoals(gList);

        const init: Record<string, boolean> = {};
        gList.forEach((g) => {
          init[g.goal_id] = false;
        });
        setCheckedGoalIds(init);
      }

      setLoading(false);
    })();
  }, [sessionId, navigate, pathVariant]);

  useEffect(() => {
    if (!isB) return;
    if (!loading && goalsDone && session?.status === "active") {
      void endSession("goals_done");
    }
  }, [isB, loading, goalsDone, session?.status]);

  async function startListening() {
    if (playState !== "idle") return;
    if (isAiSpeaking || isAiVoicePending) return;

    stopAnyAudio();

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setSpeechSupported(false);
      alert("이 브라우저에서는 음성 인식이 안정적으로 지원되지 않아요. Safari에서 다시 시도해주세요.");
      return;
    }

    setInterimText("");
    finalTranscriptRef.current = "";
    listeningStartedAtRef.current = Date.now();
    startHandledRef.current = false;

    const mobile = isMobileDevice();
    const ios = isIOS();

    const rec: SpeechRecognitionLike = new Ctor();
    recognitionRef.current = rec;

    rec.lang = "en-US";
    rec.continuous = ios ? false : !mobile;
    rec.interimResults = ios ? false : !mobile;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      if (startHandledRef.current) return;
      startHandledRef.current = true;
      setPlayState("listening");
      void unlockAudioOnce();
    };

    rec.onerror = (e) => {
      console.error("stt error", e);
      recognitionRef.current = null;
      setPlayState("idle");
      setInterimText("");
      finalTranscriptRef.current = "";

      const err = e?.error ?? "";
      if (err === "not-allowed" || err === "service-not-allowed") {
        alert("마이크 권한이 필요해요. 아이폰에서는 Safari에서 열고, 브라우저 설정에서 마이크를 허용해주세요.");
        return;
      }
      if (err === "no-speech") {
        alert("음성이 감지되지 않았어요. 조금 더 가까이에서 또박또박 말해보세요.");
        return;
      }
      if (err === "audio-capture") {
        alert("마이크를 사용할 수 없어요. 이어폰/블루투스 연결 상태나 브라우저 권한을 확인해주세요.");
        return;
      }

      alert("음성 인식에 실패했어요. 다시 시도해줘.");
    };

    rec.onresult = (e) => {
      let interim = "";

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const transcript = (res[0]?.transcript ?? "").trim();
        if (!transcript) continue;

        if (res.isFinal) {
          finalTranscriptRef.current += (finalTranscriptRef.current ? " " : "") + transcript;
        } else {
          interim += (interim ? " " : "") + transcript;
        }
      }

      if (!mobile) {
        const preview = [finalTranscriptRef.current, interim].filter(Boolean).join(" ");
        setInterimText(preview.trim());
      }
    };

    rec.onend = () => {
      recognitionRef.current = null;

      const finalText = (finalTranscriptRef.current || "").trim();

      setInterimText("");
      finalTranscriptRef.current = "";

      setPlayState((prev) => (prev === "processing" ? prev : "idle"));

      const tooShort = finalText.length < 2;
      const tooFast = Date.now() - listeningStartedAtRef.current < 400;

      if (!tooShort && !tooFast) {
        void handleUserUtterance(finalText);
      }
    };

    try {
      rec.start();
    } catch (err) {
      console.error(err);
      recognitionRef.current = null;
      alert("음성 인식을 시작할 수 없습니다.");
      setPlayState("idle");
    }
  }

  function stopListening() {
    if (playState !== "listening") return;
    try {
      recognitionRef.current?.stop();
    } catch {
      recognitionRef.current = null;
      setPlayState("idle");
    }
  }

  async function handleUserUtterance(text: string) {
    if (!sessionId || !session || !scenario) return;

    if (!isB && pairTurnsNow >= turnLimit) {
      await endSession("turn_limit");
      return;
    }

    if (isB && goalsDone) {
      await endSession("goals_done");
      return;
    }

    setPlayState("processing");
    if (!hasUserStarted) setHasUserStarted(true);

    const userNo = await getNextTurnNo();
    const { data: uTurn, error: uErr } = await supabase
      .from("roleplay_turns")
      .insert({
        session_id: sessionId,
        turn_no: userNo,
        role: "user",
        text_raw: text,
      })
      .select("turn_id,created_at")
      .single();

    if (uErr) {
      alert(`유저 턴 저장 실패: ${uErr.message}`);
      setPlayState("idle");
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: uTurn.turn_id,
        role: "user",
        text,
        createdAt: new Date(uTurn.created_at).getTime(),
      },
    ]);

    const nextUserCount = (session.turn_count_user ?? 0) + 1;
    await supabase.from("roleplay_sessions").update({ turn_count_user: nextUserCount }).eq("session_id", sessionId);
    setSession((prev) => (prev ? { ...prev, turn_count_user: nextUserCount } : prev));

    let aiText = "Sorry, could you say that again?";
    let correction: string | null = null;

    try {
      const res = await generateAiTextWithEdge(text);
      aiText = res.ai_text || aiText;
      correction = res.correction ?? null;
    } catch (e: any) {
      console.error(e);
      alert(`AI 호출 실패: ${e?.message ?? "unknown error"}`);
    }

    if ((settings?.correction_mode ?? "suggest") === "correct" && correction) {
      await supabase.from("roleplay_turns").update({ text_corrected: correction }).eq("turn_id", uTurn.turn_id);
      setMessages((prev) =>
        prev.map((m) => (m.id === uTurn.turn_id ? { ...m, correctedText: correction } : m))
      );
    }

    const aiNo = await getNextTurnNo();
    const { data: aTurn, error: aErr } = await supabase
      .from("roleplay_turns")
      .insert({
        session_id: sessionId,
        turn_no: aiNo,
        role: "ai",
        text_raw: aiText,
        audio_url: null,
      })
      .select("turn_id,created_at")
      .single();

    if (aErr) {
      alert(`AI 턴 저장 실패: ${aErr.message}`);
      setPlayState("idle");
      return;
    }

    const newAiMsg: Msg = {
      id: aTurn.turn_id,
      role: "ai",
      text: aiText,
      createdAt: new Date(aTurn.created_at).getTime(),
      audioUrl: null,
      canAutoplay: false,
    };
    setMessages((prev) => [...prev, newAiMsg]);

    const nextAiCount = (session.turn_count_ai ?? 0) + 1;
    await supabase.from("roleplay_sessions").update({ turn_count_ai: nextAiCount }).eq("session_id", sessionId);
    setSession((prev) => (prev ? { ...prev, turn_count_ai: nextAiCount } : prev));

    if (isB && goals.length > 0) {
      try {
        const out = await checkGoalsWithEdge({
          sessionId,
          scenarioId: scenario.scenario_id,
          userText: text,
          aiText,
          goals,
        });

        const achieved = Array.isArray(out?.achieved_goal_ids) ? out.achieved_goal_ids : [];
        if (achieved.length > 0) {
          setCheckedGoalIds((prev) => {
            const next = { ...prev };
            achieved.forEach((id) => {
              next[id] = true;
            });
            return next;
          });
        }
      } catch (e) {
        console.error("goal_check failed", e);
      }
    }

    // ✅ 텍스트는 먼저 보여주고, 음성은 뒤에서 생성
    setPlayState("idle");
    setIsAiVoicePending(true);

    let ttsUrl: string | null = null;
    try {
      const tts = await generateTtsWithEdge(aiText);
      ttsUrl = tts.tts_audio_url ?? null;
    } catch (e) {
      console.error("tts failed", e);
    }

    if (ttsUrl) {
      await supabase.from("roleplay_turns").update({ audio_url: ttsUrl }).eq("turn_id", aTurn.turn_id);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === newAiMsg.id
            ? {
                ...m,
                audioUrl: ttsUrl,
              }
            : m
        )
      );

      const ok = await tryAutoplay(ttsUrl);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === newAiMsg.id
            ? {
                ...m,
                audioUrl: ttsUrl,
                canAutoplay: ok,
              }
            : m
        )
      );
    }

    setIsAiVoicePending(false);

    if (!isB) {
      const nextPairTurns = Math.min(nextUserCount, nextAiCount);
      if (nextPairTurns >= turnLimit) {
        await endSession("turn_limit");
      }
    }
  }

  const micLabel = useMemo(() => {
    const mobile = isMobileDevice();

    if (!speechSupported) {
      return isIOS()
        ? "이 기기에서는 음성 인식이 불안정할 수 있어요. Safari에서 다시 시도해주세요."
        : "이 브라우저에서는 음성 인식을 지원하지 않아요.";
    }

    if (isAiVoicePending) {
      return "AI 음성을 준비 중이에요.";
    }

    if (isAiSpeaking) {
      return "AI가 말하고 있어요. 끝난 뒤에 다시 말해주세요.";
    }

    if (isB) {
      if (playState === "idle") {
        return mobile ? "버튼을 누르고 한 문장씩 말해주세요" : "버튼을 누르고 대화를 시작해주세요";
      }
      if (playState === "listening") {
        return mobile ? "듣고 있어요. 말이 끝나면 자동으로 전송돼요." : "듣고 있어요. 말이 끝나면 다시 버튼을 눌러주세요.";
      }
      return "응답을 기다리고 있어요";
    }

    if (!hasUserStarted) {
      return mobile ? "버튼을 누르고 한 문장씩 말해주세요" : "버튼을 누르고 대화를 시작해주세요";
    }
    if (playState === "idle") {
      return mobile ? "버튼을 누르고 한 문장씩 말해주세요" : "말을 시작할 때 버튼을 눌러주세요";
    }
    if (playState === "listening") {
      return mobile ? "듣고 있어요. 말이 끝나면 자동으로 전송돼요." : "듣고 있어요. 말이 끝나면 다시 버튼을 눌러주세요.";
    }
    return "처리 중…";
  }, [isB, hasUserStarted, playState, speechSupported, isAiSpeaking, isAiVoicePending]);

  if (loading) return <div className={styles.loading}>불러오는 중…</div>;

  if (fatal) {
    return (
      <div className={styles.loading}>
        <div style={{ marginBottom: 10, color: "#b00020" }}>에러: {fatal}</div>
        <button className={styles.smallBtn} onClick={() => navigate(-1)}>
          뒤로가기
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.topArea}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>{scenario?.title ?? "시나리오 명"}</div>
          <button className={styles.closeBtn} onClick={() => endSession("user_exit")} aria-label="close">
            ✕
          </button>
        </div>

        <div className={styles.metaRow}>
          <div className={styles.timer}>{mmss(elapsedSec)}</div>

          {!isB ? (
            <div className={styles.turnCount}>
              {pad2(Math.min(pairTurnsNow, turnLimit))}/{pad2(turnLimit)}
            </div>
          ) : (
            <div className={styles.turnCount}>
              {goalsCheckedCount}/{Math.max(1, goalsCount)}
            </div>
          )}
        </div>

        {!isB && (
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progressRatio * 100}%` }} />
          </div>
        )}

        {isB && (
          <div className={styles.goalPanel}>
            <div className={styles.goalPanelTitle}>목표</div>
            <div className={styles.goalBox}>
              {goals.map((g) => {
                const checked = !!checkedGoalIds[g.goal_id];
                return (
                  <div key={g.goal_id} className={styles.goalItem}>
                    <img src={checked ? "/check_act.svg" : "/check_dis.svg"} className={styles.goalIcon} alt="" />
                    <span className={styles.goalText}>{g.goal_title}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!isB && (
          <div className={styles.scDescCard}>
            <div className={styles.scDescTitle}>시나리오 설명</div>
            <div className={styles.scDescBody}>{scenario?.scenario_desc ?? "설명 문장"}</div>
          </div>
        )}
      </div>

      <div ref={chatScrollRef} className={styles.chatArea}>
        {messages.map((m) => {
          const isAiMsg = m.role === "ai";
          return (
            <div key={m.id} className={isAiMsg ? styles.aiWrap : styles.userWrap}>
              <div className={isAiMsg ? styles.aiBubble : styles.userBubble}>
                <div className={styles.bubbleText}>{m.text}</div>

                {isAiMsg && m.audioUrl && m.canAutoplay === false && (
                  <div className={styles.subRow}>
                    <span className={styles.autoPlayHint}>자동재생이 막혔어요</span>
                  </div>
                )}

                {!isAiMsg && (settings?.correction_mode ?? "suggest") === "correct" && (
                  <>
                    {!m.correctedText ? (
                      <div className={styles.subAction}>교정하기</div>
                    ) : (
                      <div className={styles.correctionCard}>
                        <div className={styles.correctionTitle}>교정</div>
                        <div className={styles.correctionBody}>{m.correctedText}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {playState === "listening" && interimText.trim() && (
          <div className={styles.userWrap}>
            <div className={styles.userBubble}>
              <div className={styles.bubbleText} style={{ opacity: 0.7 }}>
                {interimText}
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className={styles.micArea}>
        <div className={styles.micHint}>{micLabel}</div>

        <button
          className={styles.micBtn}
          onClick={playState === "listening" ? stopListening : startListening}
          disabled={
            !speechSupported ||
            isAiSpeaking ||
            isAiVoicePending ||
            playState === "processing" ||
            (!isB && pairTurnsNow >= turnLimit) ||
            (isB && goalsDone)
          }
          aria-label="mic"
        >
          <img
            className={styles.micIcon}
            src={playState === "listening" ? "/record.svg" : "/speak.svg"}
            alt={playState === "listening" ? "record" : "speak"}
          />
        </button>
      </div>
    </div>
  );
}
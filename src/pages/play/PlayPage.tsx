// src/pages/play/PlayPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import styles from "./PlayPage.module.css";

type VariantPath = "a" | "b";
function normalizeVariant(v: unknown): VariantPath {
  return v === "b" ? "b" : "a";
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
  status: string; // active | ended ...
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
  goal_text: string;
  sort_order: number;
};

// ---- speech typings ----
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
  const variant = normalizeVariant(params.variant);
  const sessionId = params.sessionId;

  const isB = variant === "b";

  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);

  const [playState, setPlayState] = useState<PlayState>("idle");
  const [messages, setMessages] = useState<Msg[]>([]);

  const [session, setSession] = useState<SessionRow | null>(null);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [scenario, setScenario] = useState<ScenarioRow | null>(null);
  const [npc, setNpc] = useState<NpcRow | null>(null);

  const [elapsedSec, setElapsedSec] = useState(0);

  const [hasUserStarted, setHasUserStarted] = useState(false);

  // B goals
  const [goals, setGoals] = useState<ScenarioGoalRow[]>([]);
  const [checkedGoalIds, setCheckedGoalIds] = useState<Record<string, boolean>>({});

  // STT
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef<string>("");
  const listeningStartedAtRef = useRef<number>(0);
  const [interimText, setInterimText] = useState<string>("");

  // scroll
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // audio
  const audioUnlockedRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // 종료 중복 방지
  const endingRef = useRef(false);

  // ====== A 턴 계산: "나+AI 왕복 1회" = 1턴 ======
  const turnLimit = useMemo(() => session?.turn_limit ?? 20, [session?.turn_limit]);
  const pairTurnsNow = useMemo(() => {
    const u = session?.turn_count_user ?? 0;
    const a = session?.turn_count_ai ?? 0;
    return Math.min(u, a);
  }, [session?.turn_count_user, session?.turn_count_ai]);

  const progressRatio = useMemo(() => {
    if (isB) return 0; // B는 턴 제한 안 씀(프로그레스바 숨길거라 의미 없음)
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

  // timer
  useEffect(() => {
    const t = setInterval(() => {
      if (session?.status === "active") setElapsedSec((v) => v + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [session?.status]);

  // scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, interimText]);

  // cleanup
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {}
      try {
        currentAudioRef.current?.pause();
        currentAudioRef.current = null;
      } catch {}
    };
  }, []);

  async function getNextTurnNo(): Promise<number> {
    if (!sessionId) return 1;
    const { data, error } = await supabase
      .from("roleplay_turns")
      .select("turn_no")
      .eq("session_id", sessionId)
      .order("turn_no", { ascending: false })
      .limit(1);

    if (error) return (messages?.length ?? 0) + 1;
    const maxNo = data?.[0]?.turn_no ?? 0;
    return maxNo + 1;
  }

  function stopAnyAudio() {
    try {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
      }
    } catch {}
    currentAudioRef.current = null;
  }

  async function tryAutoplay(url: string): Promise<boolean> {
    try {
      stopAnyAudio();
      const a = new Audio(url);
      a.preload = "auto";
      (a as any).playsInline = true;
      currentAudioRef.current = a;
      await a.play();
      return true;
    } catch {
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
    } catch {
      // ignore
    }
  }

  // ✅ 세션 종료(공통): DB 업데이트 후 /{variant}/result/:sessionId 이동
  async function endSession(reason: "user_exit" | "turn_limit" | "goals_done") {
    if (!sessionId) return;
    if (endingRef.current) return;
    endingRef.current = true;

    try {
      recognitionRef.current?.stop();
    } catch {}
    stopAnyAudio();

    try {
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

  // ---- Load ----
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

      // session
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

      // settings (optional)
      const { data: setData } = await supabase
        .from("session_settings")
        .select("session_id,correction_mode,difficulty,question_speed")
        .eq("session_id", sessionId)
        .maybeSingle();
      if (setData) setSettings(setData as SettingsRow);

      if (!sess.scenario_id) {
        setFatal("세션에 scenario_id가 없습니다.");
        setLoading(false);
        return;
      }

      // scenario
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

      // npc (optional)
      const { data: npcData } = await supabase
        .from("scenario_npcs")
        .select("npc_id,scenario_id,role_name,role_desc,avatar_url,sort_order")
        .eq("scenario_id", sc.scenario_id)
        .order("sort_order", { ascending: true })
        .limit(1);
      setNpc(npcData && npcData.length > 0 ? (npcData[0] as NpcRow) : null);

      // turns
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
        canAutoplay: true,
        createdAt: new Date(t.created_at).getTime(),
      }));
      setMessages(msgs);
      setHasUserStarted(msgs.some((m) => m.role === "user" && m.text.trim().length > 0));

      // ✅ B goals load
      if (variant === "b") {
        const { data: gData } = await supabase
          .from("scenario_goals")
          .select("goal_id,scenario_id,goal_text,sort_order")
          .eq("scenario_id", sc.scenario_id)
          .order("sort_order", { ascending: true });

        const gList = (gData ?? []) as ScenarioGoalRow[];
        setGoals(gList);

        // 초기 체크 상태는 모두 false
        const init: Record<string, boolean> = {};
        gList.forEach((g) => (init[g.goal_id] = false));
        setCheckedGoalIds(init);
      }

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ✅ B: 목표 모두 달성하면 자동 종료
  useEffect(() => {
    if (!isB) return;
    if (!loading && goalsDone && session?.status === "active") {
      endSession("goals_done");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isB, loading, goalsDone, session?.status]);

  async function generateAiReplyWithEdge(userText: string) {
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
    const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

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
    if (!res.ok) throw new Error(`chat ${res.status}: ${JSON.stringify(json)}`);

    // ✅ 지금은 ai_text/correction/tts_audio_url만 쓰고,
    // 나중에 edge에서 met_goal_ids 같은 걸 내려주면 여기서 반영하면 됨.
    return json as {
      ai_text: string;
      correction: string | null;
      tts_audio_url: string | null;

      // (추후용) met_goal_ids?: string[];
    };
  }

  // ✅ 임시: B 목표 체크 업데이트(추후 edge 결과로 교체)
  function tempUpdateGoalsAfterUserTurn() {
    if (!isB) return;

    // 아직 체크 안 된 목표 중 첫 번째를 체크(데모용)
    const next = goals.find((g) => !checkedGoalIds[g.goal_id]);
    if (!next) return;

    setCheckedGoalIds((prev) => ({ ...prev, [next.goal_id]: true }));
  }

  async function startListening() {
    if (playState !== "idle") return;

    await unlockAudioOnce();

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      alert("이 브라우저는 음성 인식(Web Speech API)을 지원하지 않습니다. (Chrome 권장)");
      return;
    }

    setInterimText("");
    finalTranscriptRef.current = "";
    listeningStartedAtRef.current = Date.now();

    const rec: SpeechRecognitionLike = new Ctor();
    recognitionRef.current = rec;

    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => setPlayState("listening");

    rec.onerror = (e) => {
      console.error("stt error", e);
      setPlayState("idle");
      setInterimText("");
      finalTranscriptRef.current = "";
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
      const preview = [finalTranscriptRef.current, interim].filter(Boolean).join(" ");
      setInterimText(preview.trim());
    };

    rec.onend = () => setPlayState((prev) => (prev === "processing" ? prev : "idle"));

    try {
      rec.start();
    } catch (err) {
      console.error(err);
      alert("음성 인식을 시작할 수 없습니다.");
      setPlayState("idle");
    }
  }

  function stopListening() {
    if (playState !== "listening") return;

    try {
      recognitionRef.current?.stop();
    } catch {}

    const finalText = (finalTranscriptRef.current || "").trim();
    setInterimText("");

    const tooShort = finalText.length < 2;
    const tooFast = Date.now() - listeningStartedAtRef.current < 400;

    setPlayState("idle");
    finalTranscriptRef.current = "";

    if (!tooShort && !tooFast) handleUserUtterance(finalText);
  }

  async function handleUserUtterance(text: string) {
    if (!sessionId || !session || !scenario) return;

    // ✅ A: 이미 제한 도달이면 종료
    if (!isB && pairTurnsNow >= turnLimit) {
      await endSession("turn_limit");
      return;
    }

    // ✅ B: 목표 다 끝났으면 종료
    if (isB && goalsDone) {
      await endSession("goals_done");
      return;
    }

    setPlayState("processing");
    if (!hasUserStarted) setHasUserStarted(true);

    // 1) user turn insert
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
      { id: uTurn.turn_id, role: "user", text, createdAt: new Date(uTurn.created_at).getTime() },
    ]);

    const nextUserCount = (session.turn_count_user ?? 0) + 1;
    await supabase.from("roleplay_sessions").update({ turn_count_user: nextUserCount }).eq("session_id", sessionId);
    setSession((prev) => (prev ? { ...prev, turn_count_user: nextUserCount } : prev));

    // 2) AI 생성
    let aiText = "Sorry, could you say that again?";
    let correction: string | null = null;
    let ttsUrl: string | null = null;

    try {
      const res = await generateAiReplyWithEdge(text);
      aiText = res.ai_text || aiText;
      correction = res.correction ?? null;
      ttsUrl = res.tts_audio_url ?? null;

      // ✅ (추후) edge에서 met_goal_ids를 내려주면 여기서 checkedGoalIds 업데이트하면 됨
      // if (isB && res.met_goal_ids?.length) {
      //   setCheckedGoalIds(prev => {
      //     const next = { ...prev };
      //     res.met_goal_ids!.forEach(id => next[id] = true);
      //     return next;
      //   });
      // }

    } catch (e: any) {
      console.error(e);
      alert(`AI 호출 실패: ${e?.message ?? "unknown error"}`);
    }

    // ✅ 임시: B는 사용자 1회 발화할 때마다 목표 1개 체크(나중에 edge 로직으로 교체)
    if (isB) tempUpdateGoalsAfterUserTurn();

    if ((settings?.correction_mode ?? "suggest") === "correct" && correction) {
      await supabase.from("roleplay_turns").update({ text_corrected: correction }).eq("turn_id", uTurn.turn_id);
      setMessages((prev) => prev.map((m) => (m.id === uTurn.turn_id ? { ...m, correctedText: correction } : m)));
    }

    // 3) ai turn insert
    const aiNo = await getNextTurnNo();
    const { data: aTurn, error: aErr } = await supabase
      .from("roleplay_turns")
      .insert({
        session_id: sessionId,
        turn_no: aiNo,
        role: "ai",
        text_raw: aiText,
        audio_url: ttsUrl,
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
      audioUrl: ttsUrl,
      canAutoplay: true,
    };
    setMessages((prev) => [...prev, newAiMsg]);

    const nextAiCount = (session.turn_count_ai ?? 0) + 1;
    await supabase.from("roleplay_sessions").update({ turn_count_ai: nextAiCount }).eq("session_id", sessionId);
    setSession((prev) => (prev ? { ...prev, turn_count_ai: nextAiCount } : prev));

    // 4) 첫 user 이후부터 자동재생
    if (ttsUrl) {
      const ok = await tryAutoplay(ttsUrl);
      setMessages((prev) => prev.map((m) => (m.id === newAiMsg.id ? { ...m, canAutoplay: ok } : m)));
    }

    // ✅ A: 왕복 1턴 완료 체크 → 제한이면 종료
    if (!isB) {
      const nextPairTurns = Math.min(nextUserCount, nextAiCount);
      if (nextPairTurns >= turnLimit) {
        setPlayState("idle");
        await endSession("turn_limit");
        return;
      }
    }

    // ✅ B: 목표 다 채웠으면 종료(즉시 반영)
    if (isB) {
      const willDone =
        goals.length > 0 && goals.every((g) => (g.goal_id in checkedGoalIds ? checkedGoalIds[g.goal_id] : false));
      // 위 willDone은 setState 타이밍상 즉시 반영이 어려울 수 있어,
      // goalsDone useEffect가 최종적으로 종료를 처리해줌.
      // (즉시 종료를 원하면 checkedGoalIds를 함수형 업데이트로 계산해서 여기서 판정하면 됨)
    }

    setPlayState("idle");
  }

  const micLabel = useMemo(() => {
    if (isB) {
      if (playState === "idle") return "버튼을 누르고 대화를 시작해주세요";
      if (playState === "listening") return "듣고 있어요. 말이 끝나면 다시 버튼을 눌러주세요.";
      return "응답을 기다리고 있어요";
    }

    // A
    if (!hasUserStarted) return "버튼을 누르고 대화를 시작해주세요";
    if (playState === "idle") return "말을 시작할 때 버튼을 눌러주세요";
    if (playState === "listening") return "듣고 있어요. 말이 끝나면 다시 버튼을 눌러주세요.";
    return "처리 중…";
  }, [isB, hasUserStarted, playState]);

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
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitle}>{scenario?.title ?? "시나리오 명"}</div>
        <button className={styles.closeBtn} onClick={() => endSession("user_exit")} aria-label="close">
          ✕
        </button>
      </div>

      {/* Timer + progress */}
      <div className={styles.metaRow}>
        <div className={styles.timer}>{mmss(elapsedSec)}</div>

        {/* ✅ A는 턴 표기, B는 목표 표기로 */}
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

      {/* ✅ A만 프로그레스바 보여주기 */}
      {!isB && (
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${progressRatio * 100}%` }} />
        </div>
      )}

      {/* ✅ B: 목표 박스(두 번째 목업처럼) */}
      {isB && (
        <div className={styles.goalPanel}>
          <div className={styles.goalPanelTitle}>목표</div>
          <div className={styles.goalBox}>
            {goals.map((g) => {
              const checked = !!checkedGoalIds[g.goal_id];
              return (
                <div key={g.goal_id} className={styles.goalItem}>
                  <img
                    src={checked ? "/check_act.svg" : "/check_dis.svg"}
                    className={styles.goalIcon}
                    alt=""
                  />
                  <span className={styles.goalText}>{g.goal_text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Scenario desc (A/B 모두 상단에 카드) */}
      <div className={styles.scDescCard}>
        <div className={styles.scDescTitle}>시나리오 설명</div>
        <div className={styles.scDescBody}>{scenario?.scenario_desc ?? "설명 문장"}</div>
      </div>

      {/* Chat */}
      <div className={styles.chatArea}>
        {messages.map((m) => {
          const isAi = m.role === "ai";
          return (
            <div key={m.id} className={isAi ? styles.aiWrap : styles.userWrap}>
              <div className={isAi ? styles.aiBubble : styles.userBubble}>
                <div className={styles.bubbleText}>{m.text}</div>

                {isAi && m.audioUrl && m.canAutoplay === false && (
                  <div className={styles.subRow}>
                    <span className={styles.autoPlayHint}>자동재생이 막혔어요</span>
                  </div>
                )}

                {!isAi && (settings?.correction_mode ?? "suggest") === "correct" && (
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

      {/* Mic */}
      <div className={styles.micArea}>
        <div className={styles.micHint}>{micLabel}</div>

        <button
          className={styles.micBtn}
          onClick={playState === "listening" ? stopListening : startListening}
          disabled={playState === "processing" || (!isB && pairTurnsNow >= turnLimit) || (isB && goalsDone)}
          aria-label="mic"
        >
          <img
            className={styles.micIcon}
            src={playState === "listening" ? "/record.png" : "/speak.png"}
            alt={playState === "listening" ? "record" : "speak"}
          />
        </button>
      </div>
    </div>
  );
}
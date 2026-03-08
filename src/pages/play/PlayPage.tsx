import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import {
  RealtimeVoiceClient,
  extractRealtimeAssistantText,
  extractRealtimeUserText,
} from "@/lib/realtimeClient";
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

function isIOS() {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua);
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

  const [elapsedSec, setElapsedSec] = useState(0);
  const [hasUserStarted, setHasUserStarted] = useState(false);

  const [goals, setGoals] = useState<ScenarioGoalRow[]>([]);
  const [checkedGoalIds, setCheckedGoalIds] = useState<Record<string, boolean>>({});

  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const realtimeRef = useRef<RealtimeVoiceClient | null>(null);
  const endingRef = useRef(false);
  const lastUserTextRef = useRef<string>("");
  const sessionRef = useRef<SessionRow | null>(null);
  const scenarioRef = useRef<ScenarioRow | null>(null);
  const goalsRef = useRef<ScenarioGoalRow[]>([]);
  const isBRef = useRef(false);
  const turnLimitRef = useRef(20);

  const variant: VariantPath = normalizeVariant(session?.variant ?? pathVariant);
  const isB = variant === "b";

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
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  useEffect(() => {
    goalsRef.current = goals;
  }, [goals]);

  useEffect(() => {
    isBRef.current = isB;
  }, [isB]);

  useEffect(() => {
    turnLimitRef.current = turnLimit;
  }, [turnLimit]);

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
  }, [messages.length]);

  useEffect(() => {
    return () => {
      realtimeRef.current?.close();
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
    return (data?.[0]?.turn_no ?? 0) + 1;
  }

  async function endSession(reason: "user_exit" | "turn_limit" | "goals_done") {
    if (!sessionId) return;
    if (endingRef.current) return;
    endingRef.current = true;

    realtimeRef.current?.stopMic();

    if (reason !== "user_exit") {
      const started = Date.now();
      while (isAiSpeaking && Date.now() - started < 15000) {
        await new Promise((r) => setTimeout(r, 200));
      }
      await new Promise((r) => setTimeout(r, 3000));
    } else {
      realtimeRef.current?.close();
    }

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

  async function handleRealtimeEvent(event: any) {
    const userText = extractRealtimeUserText(event);

    if (userText && sessionId) {
      lastUserTextRef.current = userText;
      setHasUserStarted(true);

      const userNo = await getNextTurnNo();
      const { data: uTurn, error: uErr } = await supabase
        .from("roleplay_turns")
        .insert({
          session_id: sessionId,
          turn_no: userNo,
          role: "user",
          text_raw: userText,
        })
        .select("turn_id,created_at")
        .single();

      if (!uErr && uTurn) {
        setMessages((prev) => [
          ...prev,
          {
            id: uTurn.turn_id,
            role: "user",
            text: userText,
            createdAt: new Date(uTurn.created_at).getTime(),
          },
        ]);
      }

      const currentSession = sessionRef.current;
      const nextUserCount = (currentSession?.turn_count_user ?? 0) + 1;

      await supabase
        .from("roleplay_sessions")
        .update({ turn_count_user: nextUserCount })
        .eq("session_id", sessionId);

      setSession((prev) => (prev ? { ...prev, turn_count_user: nextUserCount } : prev));
    }

    const aiText = extractRealtimeAssistantText(event);

    if (aiText && sessionId) {
      const aiNo = await getNextTurnNo();
      const { data: aTurn, error: aErr } = await supabase
        .from("roleplay_turns")
        .insert({
          session_id: sessionId,
          turn_no: aiNo,
          role: "ai",
          text_raw: aiText,
        })
        .select("turn_id,created_at")
        .single();

      if (!aErr && aTurn) {
        setMessages((prev) => [
          ...prev,
          {
            id: aTurn.turn_id,
            role: "ai",
            text: aiText,
            createdAt: new Date(aTurn.created_at).getTime(),
          },
        ]);
      }

      const currentSession = sessionRef.current;
      const nextAiCount = (currentSession?.turn_count_ai ?? 0) + 1;

      await supabase
        .from("roleplay_sessions")
        .update({ turn_count_ai: nextAiCount })
        .eq("session_id", sessionId);

      setSession((prev) => (prev ? { ...prev, turn_count_ai: nextAiCount } : prev));

      if (
        isBRef.current &&
        goalsRef.current.length > 0 &&
        lastUserTextRef.current &&
        scenarioRef.current?.scenario_id
      ) {
        try {
          const out = await checkGoalsWithEdge({
            sessionId,
            scenarioId: scenarioRef.current.scenario_id,
            userText: lastUserTextRef.current,
            aiText,
            goals: goalsRef.current,
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

      if (!isBRef.current) {
        const latestSession = sessionRef.current;
        const nextPairTurns = Math.min(
          latestSession?.turn_count_user ?? 0,
          (latestSession?.turn_count_ai ?? 0) + 1
        );

        if (nextPairTurns >= turnLimitRef.current) {
          void endSession("turn_limit");
        }
      }

      setPlayState("idle");
    }
  }

  async function ensureRealtimeConnected() {
    if (realtimeRef.current?.isConnected()) return;
    if (!scenario) throw new Error("scenario not loaded");

    setConnecting(true);

    const { data: authSess } = await supabase.auth.getSession();
    const accessToken = authSess.session?.access_token;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

    const origFetch = window.fetch;
    window.fetch = async (input, init) => {
      if (typeof input === "string" && input.includes("realtime_session")) {
        const res = await origFetch(input, init);
        if (!res.ok) return res;
        const text = await res.text();
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {
          return new Response(text, { status: res.status, headers: res.headers });
        }
        
        // Fix the token extraction bug: If the edge function failed to extract it into 'value', we find it in raw.
        const token = json.value || json.raw?.value || json.raw?.client_secret?.value;
        if (token) {
          return new Response(JSON.stringify({ value: token }), { status: res.status, headers: res.headers });
        }
        return new Response(text, { status: res.status, headers: res.headers });
      }
      return origFetch(input, init);
    };

    const client = new RealtimeVoiceClient({
      tokenEndpoint: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/realtime_session`,
      tokenHeaders: {
        apikey: anonKey,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      sessionPayload: {
        voice: "marin",
        instructions: [
          // ⚡ 최우선 언어 설정: OpenAI 기본 다국어 지시를 덮어쓰기 위해 맨 앞에 배치
          "CRITICAL: You MUST respond ONLY in English at all times, regardless of what language the user speaks. Never switch to any other language.",
          "You are roleplaying as an NPC in an English conversation training app.",
          "Keep each reply natural and short.",
          "Ask one question at a time.",
          "Stay in character.",
          `Scenario title: ${scenario.title}`,
          scenario.scenario_desc ? `Scenario situation: ${scenario.scenario_desc}` : "",
          `You are: ${npc?.role_name ?? "NPC"}`,
          npc?.role_desc ? `Role details: ${npc.role_desc}` : "",
          `Difficulty: ${settings?.difficulty ?? "basic"}`,
          `Correction mode: ${settings?.correction_mode ?? "suggest"}`,
          "The user is speaking with voice. Reply with conversational spoken English.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
      onRemoteAudioStart: () => setIsAiSpeaking(true),
      onRemoteAudioStop: () => setIsAiSpeaking(false),
      onError: (message) => {
        console.error("[Realtime] 연결 중 오류:", message);
        // 연결 중 발생한 오류를 사용자에게 즉시 알립니다
        alert(`음성 연결 오류: ${message}`);
        setPlayState("idle");
        setConnecting(false);
      },
      onEvent: async (event) => {
        await handleRealtimeEvent(event);
      },
    });

    try {
      await client.connect();
      realtimeRef.current = client;
    } catch (e) {
      // 연결 실패 시 생성된 WebRTC 연결, audio 요소 등을 모두 정리합니다
      client.close();
      throw e;
    } finally {
      window.fetch = origFetch;
      setConnecting(false);
    }
  }

  async function connectRealtimeWithRetry(maxRetries = 3) {
    let lastError: any = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        await ensureRealtimeConnected();
        return;
      } catch (e) {
        lastError = e;
        console.error(`Realtime connect retry ${i + 1}/${maxRetries} failed`, e);

        if (i < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        }
      }
    }

    throw lastError;
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
        .select("turn_id,session_id,turn_no,role,text_raw,text_corrected,created_at")
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
    if (isAiSpeaking) return;

    try {
      await connectRealtimeWithRetry(3);
      realtimeRef.current?.startMic();
      setPlayState("listening");
    } catch (e: any) {
      console.error(e);
      alert(`Realtime 연결 실패: ${e?.message ?? "unknown error"}`);
      setPlayState("idle");
      setConnecting(false);
    }
  }

  function stopListening() {
  const client = realtimeRef.current;
  if (!client) return;

  client.stopMic();

  client.sendEvent({
    type: "response.create",
  });

  setPlayState("processing");
}

  const micLabel = useMemo(() => {
    if (connecting) return "연결 중…";
    if (isAiSpeaking) return "AI가 말하고 있어요. 끝난 뒤에 다시 말해주세요.";

    if (isB) {
      if (playState === "idle") {
        return "버튼을 누르고 말해주세요";
      }
      if (playState === "listening") {
        return isIOS()
          ? "말이 끝나면 버튼을 다시 눌러주세요."
          : "듣고 있어요. 말이 끝나면 버튼을 다시 눌러주세요.";
      }
      return "응답을 기다리고 있어요";
    }

    if (!hasUserStarted) return "버튼을 누르고 대화를 시작해주세요";
    if (playState === "idle") return "말을 시작할 때 버튼을 눌러주세요";
    if (playState === "listening") return "듣고 있어요. 말이 끝나면 버튼을 다시 눌러주세요.";
    return "응답을 기다리고 있어요";
  }, [connecting, isAiSpeaking, isB, playState, hasUserStarted]);

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
          <button className={styles.closeBtn} onClick={() => void endSession("user_exit")} aria-label="close">
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

        <div ref={bottomRef} />
      </div>

      <div className={styles.micArea}>
        <div className={styles.micHint}>{micLabel}</div>

        <button
          className={styles.micBtn}
          onClick={playState === "listening" ? stopListening : () => void startListening()}
          disabled={connecting || isAiSpeaking || (!isB && pairTurnsNow >= turnLimit) || (isB && goalsDone)}
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
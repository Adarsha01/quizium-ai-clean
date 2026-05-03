import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navbar } from "@/components/navbar";
import { ProtectedRoute } from "@/components/protected-route";
import { BackButton } from "@/components/back-button";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Trophy,
  RotateCcw,
  Clock,
  Play,
  AlertTriangle,
  PartyPopper,
  Bookmark,
  BookmarkCheck,
  Shuffle,
  Crosshair,
  Lightbulb,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { generateQuiz } from "@/server/quiz.functions";
import { awardXpAndAchievements, levelFromXp } from "@/lib/gamification";

type QuizMode = "standard" | "focus" | "daily" | "challenge";
type ChallengeType = "previous" | "top" | "speed";

export const Route = createFileRoute("/quiz/$pdfId/$difficulty")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    mode?: QuizMode;
    count?: number;
    challengeType?: ChallengeType;
    target?: number;
    time?: number; // minutes override (challenge mode)
  } => {
    const m = search.mode;
    const mode: QuizMode | undefined =
      m === "focus"
        ? "focus"
        : m === "daily"
          ? "daily"
          : m === "challenge"
            ? "challenge"
            : undefined;
    const rawCount = Number(search.count);
    const count =
      Number.isFinite(rawCount) && rawCount >= 3 && rawCount <= 20
        ? Math.floor(rawCount)
        : undefined;
    const ct = search.challengeType;
    const challengeType: ChallengeType | undefined =
      ct === "previous" || ct === "top" || ct === "speed" ? ct : undefined;
    const rawTarget = Number(search.target);
    const target =
      Number.isFinite(rawTarget) && rawTarget >= 0 && rawTarget <= 100
        ? Math.round(rawTarget)
        : undefined;
    const rawTime = Number(search.time);
    const time =
      Number.isFinite(rawTime) && rawTime >= 1 && rawTime <= 60
        ? Math.floor(rawTime)
        : undefined;
    return { mode, count, challengeType, target, time };
  },
  component: () => (
    <ProtectedRoute requireRole="student">
      <QuizPage />
    </ProtectedRoute>
  ),
});

interface Q {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  concept?: string;
  tip?: string;
  page_reference?: string;
}

const PASS_THRESHOLD = 60;
// Default quiz: 20 questions, 20 minutes. Daily / shorter quizzes scale time
// proportionally — 1 minute per question.
const SECONDS_PER_QUESTION = 60;

type Phase = "loading" | "ready" | "active" | "submitting" | "done" | "error";

function QuizPage() {
  const { pdfId, difficulty } = Route.useParams();
  const {
    mode: searchMode,
    count: searchCount,
    challengeType,
    target: targetScore,
    time: timeOverride,
  } = Route.useSearch();
  const isFocusMode = searchMode === "focus";
  const isDailyMode = searchMode === "daily";
  const isChallengeMode = searchMode === "challenge";
  const isSpeedChallenge = isChallengeMode && challengeType === "speed";
  const QUESTION_COUNT = searchCount ?? (isDailyMode ? 5 : 20);
  // Challenge mode honors explicit ?time= override; speed defaults to 10 min.
  const TIME_LIMIT_SECONDS = isChallengeMode
    ? (timeOverride ?? (isSpeedChallenge ? 10 : 20)) * 60
    : QUESTION_COUNT * SECONDS_PER_QUESTION;
  const { user } = useAuth();
  const navigate = useNavigate();

  const [questions, setQuestions] = useState<Q[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pdfTitle, setPdfTitle] = useState<string>("");
  const [unitId, setUnitId] = useState<string>("");

  const [current, setCurrent] = useState(0);
  // answers[i] = chosen index, or null if unanswered
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  // marked[i] = user flagged this question for later review
  const [marked, setMarked] = useState<boolean[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(TIME_LIMIT_SECONDS);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [timeTakenSeconds, setTimeTakenSeconds] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitProgress, setSubmitProgress] = useState(0);
  const [xpEarned, setXpEarned] = useState(0);
  const [newBadges, setNewBadges] = useState<string[]>([]);
  const [challengeWonState, setChallengeWonState] = useState<boolean | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  // Hints: 3 per quiz; per-question record of removed wrong-option indices
  const MAX_HINTS = 3;
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintRemoved, setHintRemoved] = useState<Record<number, number[]>>({});
  // Reaction animation state for current question (correct/wrong/null)
  const [reaction, setReaction] = useState<"correct" | "wrong" | null>(null);
  // Level-up popup
  const [levelUpInfo, setLevelUpInfo] = useState<{ level: number; xp: number } | null>(null);
  // Per-question detailed explanation toggles in review
  const [expandedExp, setExpandedExp] = useState<Record<number, boolean>>({});
  const submittedRef = useRef(false);

  // Load (or reload) the quiz. `forceRegenerate=true` wipes the cache and
  // makes the AI produce a brand-new set of questions.
  const loadQuiz = async (forceRegenerate = false, isAutoRetry = false) => {
    try {
      if (forceRegenerate) {
        setRegenerating(true);
      } else {
        setPhase("loading");
      }
      const { data: pdf } = await supabase
        .from("pdfs")
        .select("title, unit_id")
        .eq("id", pdfId)
        .maybeSingle();
      if (!pdf) throw new Error("PDF not found");
      setPdfTitle(pdf.title);
      setUnitId(pdf.unit_id);

      const result = await generateQuiz({
        data: {
          pdfId,
          difficulty: difficulty as any,
          questionCount: QUESTION_COUNT,
          forceRegenerate,
          userId: user?.id,
        },
      });
      if (!result.questions || result.questions.length < QUESTION_COUNT) {
        throw new Error("Not enough questions generated. Please regenerate quiz.");
      }
      const trimmed = result.questions.slice(0, QUESTION_COUNT);
      setQuestions(trimmed);
      setAnswers(new Array(trimmed.length).fill(null));
      setMarked(new Array(trimmed.length).fill(false));
      setCurrent(0);
      setPhase("ready");
      if (forceRegenerate) toast.success("New quiz generated");
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load quiz";
      // Auto-recover from "not enough unique questions" by forcing one regen.
      if (!isAutoRetry && /unique|enough/i.test(msg)) {
        toast.info("Generating a fresh set of questions…");
        await loadQuiz(true, true);
        return;
      }
      setError(msg);
      setPhase("error");
    } finally {
      setRegenerating(false);
    }
  };

  // Shuffle the current question order in place — does NOT call AI.
  const shuffleQuestions = () => {
    setQuestions((prev) => {
      const order = prev.map((_, i) => i).sort(() => Math.random() - 0.5);
      const shuffled = order.map((i) => prev[i]);
      // re-align answers + marks to the new order
      setAnswers((a) => order.map((i) => a[i] ?? null));
      setMarked((m) => order.map((i) => m[i] ?? false));
      return shuffled;
    });
    setCurrent(0);
    toast.success("Questions shuffled");
  };

  useEffect(() => {
    // Challenge mode always generates fresh, non-repeated questions.
    loadQuiz(isChallengeMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfId, difficulty]);

  // Submit (final)
  const submitQuiz = async (auto: boolean) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setConfirmOpen(false);
    setPhase("submitting");
    setSubmitProgress(10);

    const score = questions.reduce(
      (s, q, i) => s + (answers[i] === q.correct_index ? 1 : 0),
      0,
    );
    const taken = startedAt
      ? Math.min(TIME_LIMIT_SECONDS, Math.round((Date.now() - startedAt) / 1000))
      : TIME_LIMIT_SECONDS;
    setTimeTakenSeconds(taken);

    // Smooth fake progress while inserting
    const progressTimer = window.setInterval(() => {
      setSubmitProgress((p) => (p < 85 ? p + 7 : p));
    }, 120);

    const scorePct = Math.round((score / questions.length) * 100);
    const challengeWon =
      isChallengeMode && typeof targetScore === "number" ? scorePct > targetScore : false;

    const mode: "standard" | "focus" | "daily" | "challenge_std" | "challenge_speed" =
      isChallengeMode
        ? isSpeedChallenge
          ? "challenge_speed"
          : "challenge_std"
        : isFocusMode
          ? "focus"
          : isDailyMode
            ? "daily"
            : "standard";

    const { data: inserted, error: insErr } = await supabase
      .from("attempts")
      .insert({
        user_id: user!.id,
        pdf_id: pdfId,
        unit_id: unitId,
        difficulty: difficulty as any,
        score,
        total: questions.length,
        mode,
        details: {
          auto_submitted: auto,
          time_taken_seconds: taken,
          submitted_at: new Date().toISOString(),
          mode,
          // Challenge metadata (null-safe)
          challenge_type: isChallengeMode ? challengeType ?? null : null,
          target_score: isChallengeMode ? targetScore ?? null : null,
          challenge_won: isChallengeMode ? challengeWon : null,
          answers: questions.map((q, i) => ({
            question: q.question,
            options: q.options,
            chosen: answers[i],
            correct: q.correct_index,
            explanation: q.explanation,
            concept: q.concept ?? null,
            tip: q.tip ?? null,
            page_reference: q.page_reference ?? null,
          })),
        } as any,
      } as any)
      .select("id")
      .maybeSingle();

    window.clearInterval(progressTimer);
    setSubmitProgress(100);

    if (insErr) {
      toast.error("Couldn't save attempt: " + insErr.message);
    } else {
      if (auto) toast.warning("Time's up — quiz auto-submitted");

      // Record challenge outcome for the done screen
      if (isChallengeMode) setChallengeWonState(challengeWon);

      // ---------- Gamification: award XP + check achievements ----------
      try {
        // Pull all attempts to compute streak + high-score count + challenge counts + first-of-day bonus.
        const { data: allAttempts } = await supabase
          .from("attempts")
          .select("score, total, created_at, mode, details")
          .eq("user_id", user!.id)
          .order("created_at", { ascending: false })
          .limit(500);
        const list = allAttempts ?? [];
        const totalAttempts = list.length;
        const highScoreCount = list.filter(
          (a) => (a.score / a.total) * 100 >= 80,
        ).length;
        // Challenge totals across history (the just-inserted one is included)
        const challengeAttempts = list.filter(
          (a) => a.mode === "challenge_std" || a.mode === "challenge_speed",
        );
        const challengeCompletedCount = challengeAttempts.length;
        const challengeWonCount = challengeAttempts.filter(
          (a) => (a.details as any)?.challenge_won === true,
        ).length;
        // Compute best streak from unique day keys
        const dayKey = (iso: string) => {
          const d = new Date(iso);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        };
        const days = Array.from(new Set(list.map((a) => dayKey(a.created_at)))).sort();
        let bestStreak = 0;
        let run = 0;
        let prev: string | null = null;
        for (const k of days) {
          if (prev) {
            const p = new Date(prev);
            p.setDate(p.getDate() + 1);
            run = dayKey(p.toISOString()) === k ? run + 1 : 1;
          } else {
            run = 1;
          }
          if (run > bestStreak) bestStreak = run;
          prev = k;
        }
        // First quiz of the day → streak day bonus eligible
        const todayKey = dayKey(new Date().toISOString());
        const attemptsToday = list.filter((a) => dayKey(a.created_at) === todayKey).length;
        const streakDayBonusEligible = attemptsToday <= 1; // the just-inserted one counts

        const result = await awardXpAndAchievements({
          userId: user!.id,
          attemptId: inserted?.id ?? null,
          scorePct,
          mode,
          totalAttempts,
          highScoreCount,
          bestStreak,
          streakDayBonusEligible,
          challengeWon: isChallengeMode ? challengeWon : undefined,
          challengeCompletedCount: isChallengeMode ? challengeCompletedCount : undefined,
          challengeWonCount: isChallengeMode ? challengeWonCount : undefined,
        });
        if (result) {
          setXpEarned(result.xpGained);
          setNewBadges(result.awardedAchievements);
          if (result.leveledUp) {
            setLevelUpInfo({ level: result.newLevel, xp: result.newXp });
          }
          if (result.xpGained > 0) {
            toast.success(`+${result.xpGained} XP earned!`, {
              description:
                result.awardedAchievements.length > 0
                  ? `🏆 New achievement${result.awardedAchievements.length > 1 ? "s" : ""} unlocked!`
                  : undefined,
            });
          }
        }
      } catch (gErr) {
        console.error("[quiz] gamification step failed", gErr);
      }
    }

    // Tiny delay so the user sees 100%
    setTimeout(() => {
      setPhase("done");
      setResultOpen(true);
    }, 350);
  };

  // Timer
  useEffect(() => {
    if (phase !== "active") return;
    const id = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(id);
          // auto-submit
          submitQuiz(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const startQuiz = () => {
    setStartedAt(Date.now());
    setSecondsLeft(TIME_LIMIT_SECONDS);
    setPhase("active");
  };

  const selectAnswer = (idx: number) => {
    const q = questions[current];
    // Lock: prevent changing an already-selected answer (both modes)
    if (answers[current] !== null && answers[current] !== undefined) return;
    setAnswers((prev) => {
      const next = [...prev];
      next[current] = idx;
      return next;
    });
    if (!q) return;
    const isLast = current === questions.length - 1;
    if (isDailyMode) {
      // Learning mode: show feedback, then auto-advance
      const isCorrect = idx === q.correct_index;
      setReaction(isCorrect ? "correct" : "wrong");
      if (!isLast) {
        window.setTimeout(() => {
          setReaction(null);
          setCurrent((c) => Math.min(questions.length - 1, c + 1));
        }, 700);
      } else {
        window.setTimeout(() => setReaction(null), 700);
      }
    } else {
      // Exam mode: lock instantly, no feedback, advance immediately
      if (!isLast) {
        setCurrent((c) => Math.min(questions.length - 1, c + 1));
      }
    }
  };

  const useHint = () => {
    const q = questions[current];
    if (!q) return;
    if (hintsUsed >= MAX_HINTS) {
      toast.info("No hints remaining");
      return;
    }
    if (hintRemoved[current]?.length) {
      toast.info("Hint already used on this question");
      return;
    }
    // Remove 2 random incorrect options (50/50)
    const wrongIdx = q.options
      .map((_, i) => i)
      .filter((i) => i !== q.correct_index);
    const shuffled = wrongIdx.sort(() => Math.random() - 0.5).slice(0, 2);
    setHintRemoved((prev) => ({ ...prev, [current]: shuffled }));
    setHintsUsed((n) => n + 1);
    toast.success("💡 Two incorrect options removed");
  };

  const goNext = () => setCurrent((c) => Math.min(questions.length - 1, c + 1));
  const goPrev = () => setCurrent((c) => Math.max(0, c - 1));

  // Clear reaction animation when changing question
  useEffect(() => {
    setReaction(null);
  }, [current]);

  const toggleMark = () => {
    setMarked((prev) => {
      const next = [...prev];
      next[current] = !next[current];
      return next;
    });
  };

  const answeredCount = useMemo(() => answers.filter((a) => a !== null).length, [answers]);
  const markedCount = useMemo(() => marked.filter(Boolean).length, [marked]);

  // ---------- LOADING ----------
  if (phase === "loading") {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="mx-auto max-w-2xl px-4 pt-6">
          <BackButton fallback="/dashboard" label="Back to PDFs" className="-ml-2" />
        </main>
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary-glow" />
          <h2 className="mt-6 text-xl font-semibold">AI is crafting your quiz…</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Reading the PDF and generating 20 {difficulty} questions.
          </p>
        </div>
      </div>
    );
  }

  // ---------- ERROR ----------
  if (phase === "error") {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="mx-auto max-w-2xl px-4 pt-6">
          <BackButton fallback="/dashboard" label="Back to PDFs" className="-ml-2" />
        </main>
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <XCircle className="h-10 w-10 mx-auto text-destructive" />
          <h2 className="mt-6 text-xl font-semibold">Couldn't generate quiz</h2>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <div className="mt-6 flex gap-3 justify-center">
            <Button asChild variant="outline">
              <Link to="/dashboard">Back to dashboard</Link>
            </Button>
            <Button variant="hero" onClick={() => window.location.reload()}>
              <RotateCcw className="h-4 w-4" /> Regenerate
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- READY (start screen) ----------
  if (phase === "ready") {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="mx-auto max-w-2xl px-4 py-12">
          <BackButton fallback="/dashboard" label="Back to PDFs" className="mb-3 -ml-2" />
          <div className="rounded-3xl bg-gradient-card border border-border/60 p-8 shadow-elevated text-center">
            <div
              className={cn(
                "mx-auto flex h-14 w-14 items-center justify-center rounded-2xl",
                isFocusMode ? "bg-warning/15" : "bg-primary/15",
              )}
            >
              {isFocusMode ? (
                <Crosshair className="h-6 w-6 text-warning" />
              ) : (
                <Sparkles className="h-6 w-6 text-primary-glow" />
              )}
            </div>
            {isFocusMode && (
              <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-warning/15 border border-warning/30 px-3 py-1 text-xs font-semibold text-warning">
                <Crosshair className="h-3 w-3" /> Focus Mode
              </div>
            )}
            {isDailyMode && (
              <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary/15 border border-primary/30 px-3 py-1 text-xs font-semibold text-primary-glow">
                <Sparkles className="h-3 w-3" /> Daily Quiz
              </div>
            )}
            {isChallengeMode && (
              <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary/15 border border-primary/30 px-3 py-1 text-xs font-semibold text-primary-glow">
                <Trophy className="h-3 w-3" />{" "}
                {challengeType === "previous"
                  ? "Beat Your Previous Score"
                  : challengeType === "top"
                    ? "Beat Top Scorer"
                    : "Speed Challenge"}
                {typeof targetScore === "number" ? ` • Target ${targetScore}%` : ""}
              </div>
            )}
            <h1 className="mt-5 text-3xl font-bold">Ready to start?</h1>
            <p className="mt-2 text-muted-foreground">{pdfTitle}</p>
            {isFocusMode && (
              <p className="mt-2 text-xs text-muted-foreground">
                This quiz targets a unit you've struggled with. Focus on it to improve your score.
              </p>
            )}
            {isDailyMode && (
              <p className="mt-2 text-xs text-muted-foreground">
                A short daily warm-up to keep your streak alive 🔥
              </p>
            )}
            {isChallengeMode && (
              <p className="mt-2 text-xs text-muted-foreground">
                {isSpeedChallenge
                  ? "Same 20 questions — but only 10 minutes on the clock."
                  : "Beat the target score to win. Fresh questions every time."}
              </p>
            )}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <InfoCard label="Questions" value={`${QUESTION_COUNT} questions`} />
              <InfoCard
                label="Time limit"
                value={`${Math.round(TIME_LIMIT_SECONDS / 60)} minute${TIME_LIMIT_SECONDS / 60 === 1 ? "" : "s"}`}
              />
              <InfoCard label="Level" value={difficulty} capitalize />
              <InfoCard label="Pass mark" value={`${PASS_THRESHOLD}%`} />
            </div>

            <p className="mt-6 text-xs text-muted-foreground">
              Answers can be reviewed at the end. The quiz auto-submits when time runs out.
            </p>

            <div className="mt-7 flex flex-wrap gap-3 justify-center">
              <Button asChild variant="outline">
                <Link to="/dashboard">Cancel</Link>
              </Button>
              <Button variant="hero" size="lg" onClick={startQuiz}>
                <Play className="h-4 w-4" /> Start Quiz
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => loadQuiz(true)}
                disabled={regenerating}
              >
                {regenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                Regenerate Quiz
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={shuffleQuestions}
                disabled={regenerating}
              >
                <Shuffle className="h-3.5 w-3.5" />
                Shuffle Questions
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Regenerate creates fresh AI questions • Shuffle reorders the current set
            </p>
          </div>
        </main>
      </div>
    );
  }

  // ---------- SUBMITTING (modal-style overlay, blocks all clicks) ----------
  if (phase === "submitting") {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4"
          aria-live="polite"
          aria-busy="true"
          // Block clicks on anything underneath
          onClickCapture={(e) => e.stopPropagation()}
        >
          <div className="w-full max-w-md rounded-2xl border border-border/60 bg-gradient-card p-7 shadow-elevated animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-primary-glow" />
              <h2 className="text-lg font-semibold">Submitting your quiz…</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Saving your answers, please wait...
            </p>
            <div className="mt-5">
              <Progress value={submitProgress} />
              <div className="mt-2 text-right text-xs text-muted-foreground">
                {submitProgress}%
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- DONE (results + review) ----------
  if (phase === "done") {
    const score = questions.reduce(
      (s, q, i) => s + (answers[i] === q.correct_index ? 1 : 0),
      0,
    );
    const wrong = questions.length - score;
    const pct = Math.round((score / questions.length) * 100);
    const passed = pct >= PASS_THRESHOLD;
    const nextLevel =
      difficulty === "beginner" ? "intermediate" : difficulty === "intermediate" ? "pro" : null;

    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="mx-auto max-w-3xl px-4 py-12">
          <BackButton fallback="/dashboard" label="Back to dashboard" className="mb-3 -ml-2" />
          <div className="rounded-3xl bg-gradient-card border border-border/60 p-8 text-center shadow-elevated">
            <Trophy className={cn("mx-auto h-12 w-12", passed ? "text-primary-glow" : "text-muted-foreground")} />
            <h1 className="mt-4 text-3xl font-bold">Quiz complete!</h1>
            <p className="mt-2 text-muted-foreground">{pdfTitle}</p>
            <div className="mt-6 text-6xl font-bold text-gradient-primary">{pct}%</div>
            <p className="mt-2 text-muted-foreground">
              You scored {score} out of {questions.length}
            </p>

            <div className="mt-5 grid gap-3 grid-cols-2 sm:grid-cols-4 max-w-2xl mx-auto">
              <Stat label="Correct" value={score} tone="success" />
              <Stat label="Wrong" value={wrong} tone="destructive" />
              <Stat label="Time taken" value={formatDuration(timeTakenSeconds)} tone="neutral" />
              <Stat
                label="Result"
                value={passed ? "Passed" : "Failed"}
                tone={passed ? "success" : "destructive"}
              />
            </div>

            {isChallengeMode && (
              <div className="mt-5 rounded-2xl border border-border/60 bg-surface/40 p-4 max-w-2xl mx-auto text-left">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <Trophy
                      className={cn(
                        "h-5 w-5",
                        challengeWonState ? "text-success" : "text-muted-foreground",
                      )}
                    />
                    <span className="font-semibold">
                      {challengeWonState === true
                        ? "Challenge Won 🎉"
                        : challengeWonState === false
                          ? "Challenge Lost"
                          : "Challenge Complete"}
                    </span>
                  </div>
                  {typeof targetScore === "number" && (
                    <span className="text-sm text-muted-foreground">
                      Target: <span className="font-semibold text-foreground">{targetScore}%</span>{" "}
                      • You: <span className="font-semibold text-foreground">{pct}%</span>{" "}
                      <span
                        className={cn(
                          "ml-1 font-semibold",
                          pct - targetScore >= 0 ? "text-success" : "text-destructive",
                        )}
                      >
                        ({pct - targetScore >= 0 ? "+" : ""}
                        {pct - targetScore}%)
                      </span>
                    </span>
                  )}
                </div>
                {(xpEarned > 0 || newBadges.length > 0) && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {xpEarned > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 font-semibold text-primary-glow">
                        <Sparkles className="h-3 w-3" /> +{xpEarned} XP
                      </span>
                    )}
                    {newBadges.map((b) => (
                      <span
                        key={b}
                        className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/15 px-2 py-1 font-semibold text-warning"
                      >
                        <Trophy className="h-3 w-3" /> {b.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {passed && nextLevel && !isChallengeMode && (
              <p className="mt-4 text-sm text-success">🎉 {nextLevel} level unlocked!</p>
            )}
            {!passed && !isChallengeMode && (
              <p className="mt-4 text-sm text-muted-foreground">
                Score {PASS_THRESHOLD}%+ to unlock the next level.
              </p>
            )}

            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              <Button asChild variant="outline">
                <Link to="/dashboard">Back to dashboard</Link>
              </Button>
              <Button variant="hero" onClick={() => window.location.reload()}>
                <RotateCcw className="h-4 w-4" /> Retry
              </Button>
            </div>
          </div>

          <div className="mt-8 space-y-4">
            <h2 className="text-lg font-semibold">Review Answers</h2>
            {questions.map((q, i) => {
              const chosen = answers[i];
              const correct = chosen === q.correct_index;
              return (
                <div
                  key={q.id ?? i}
                  className="rounded-2xl bg-gradient-card border border-border/60 p-5"
                >
                  <div className="flex items-start gap-3">
                    {correct ? (
                      <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p className="font-medium">
                        {i + 1}. {q.question}
                      </p>
                      <div className="mt-3 space-y-1.5">
                        {q.options.map((opt, j) => (
                          <div
                            key={j}
                            className={cn(
                              "rounded-lg px-3 py-2 text-sm border",
                              j === q.correct_index &&
                                "bg-success/10 border-success/40 text-success",
                              j === chosen &&
                                j !== q.correct_index &&
                                "bg-destructive/10 border-destructive/40 text-destructive",
                              j !== chosen &&
                                j !== q.correct_index &&
                                "border-border/30 text-muted-foreground",
                            )}
                          >
                            {opt}
                            {j === chosen && (
                              <span className="ml-2 text-xs opacity-70">(your answer)</span>
                            )}
                          </div>
                        ))}
                        {chosen === null && (
                          <p className="text-xs text-muted-foreground italic">No answer selected</p>
                        )}
                      </div>
                      <div className="mt-3 space-y-2 rounded-lg border border-border/50 bg-surface/40 p-3 text-sm">
                        <div>
                          <span className="text-xs font-semibold uppercase tracking-wide text-success">
                            Correct Answer
                          </span>
                          <p className="mt-0.5 text-foreground">
                            {String.fromCharCode(65 + q.correct_index)}. {q.options[q.correct_index]}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs font-semibold uppercase tracking-wide text-primary-glow">
                            Explanation
                          </span>
                          <p className="mt-0.5 text-muted-foreground">{q.explanation}</p>
                        </div>
                        {(q.concept || q.tip || q.page_reference) && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedExp((prev) => ({ ...prev, [i]: !prev[i] }))
                              }
                              className="inline-flex items-center gap-1 text-xs font-medium text-primary-glow hover:underline"
                            >
                              {expandedExp[i] ? (
                                <>
                                  <ChevronUp className="h-3.5 w-3.5" /> Hide detailed explanation
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-3.5 w-3.5" /> Show detailed explanation
                                </>
                              )}
                            </button>
                            {expandedExp[i] && (
                              <div className="space-y-2 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
                                {q.concept && (
                                  <div>
                                    <span className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
                                      Concept
                                    </span>
                                    <p className="mt-0.5 text-muted-foreground">{q.concept}</p>
                                  </div>
                                )}
                                {q.tip && (
                                  <div>
                                    <span className="text-xs font-semibold uppercase tracking-wide text-warning">
                                      Tip
                                    </span>
                                    <p className="mt-0.5 text-muted-foreground">💡 {q.tip}</p>
                                  </div>
                                )}
                                <div>
                                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Reference
                                  </span>
                                  <p className="mt-0.5 text-muted-foreground">
                                    📖 {q.page_reference ?? "Based on PDF content"}
                                  </p>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </main>

        {/* Level Up celebration */}
        <Dialog
          open={!!levelUpInfo}
          onOpenChange={(open) => !open && setLevelUpInfo(null)}
        >
          <DialogContent className="rounded-2xl border-warning/40 bg-gradient-card sm:max-w-sm text-center">
            <DialogHeader>
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-primary animate-level-up animate-pulse-glow">
                <Trophy className="h-10 w-10 text-primary-foreground" />
              </div>
              <DialogTitle className="text-center text-2xl mt-2">
                Level Up! 🎉
              </DialogTitle>
              <DialogDescription className="text-center">
                You've reached a new level. Keep learning!
              </DialogDescription>
            </DialogHeader>
            {levelUpInfo && (() => {
              const info = levelFromXp(levelUpInfo.xp);
              return (
                <div className="space-y-3 py-2">
                  <div className="text-5xl font-bold text-gradient-primary">
                    Lv. {levelUpInfo.level}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{info.isMax ? "Max level" : `Progress to Lv. ${levelUpInfo.level + 1}`}</span>
                      <span className="font-medium">
                        {info.isMax
                          ? `${levelUpInfo.xp} XP`
                          : `${info.xpIntoLevel} / ${info.xpForNextLevel} XP`}
                      </span>
                    </div>
                    <Progress value={info.progressPct} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Total XP: <span className="font-semibold text-foreground">{levelUpInfo.xp}</span>
                  </p>
                </div>
              );
            })()}
            <DialogFooter>
              <Button
                variant="hero"
                className="w-full"
                onClick={() => setLevelUpInfo(null)}
              >
                Awesome!
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={resultOpen} onOpenChange={setResultOpen}>
          <DialogContent className="rounded-2xl border-border/60 bg-gradient-card sm:max-w-md">
            <DialogHeader>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15">
                <PartyPopper className="h-6 w-6 text-primary-glow" />
              </div>
              <DialogTitle className="text-center text-xl">
                Quiz Submitted Successfully!
              </DialogTitle>
              <DialogDescription className="text-center">
                Here's a quick look at how you did.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-2">
              <Stat label="Score" value={`${score}/${questions.length}`} tone="neutral" />
              <Stat label="Accuracy" value={`${pct}%`} tone={passed ? "success" : "destructive"} />
              <Stat label="Correct" value={score} tone="success" />
              <Stat label="Wrong" value={wrong} tone="destructive" />
              <div className="col-span-2">
                <Stat label="Time taken" value={formatDuration(timeTakenSeconds)} tone="neutral" />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" asChild className="flex-1">
                <Link to="/dashboard">Back to Dashboard</Link>
              </Button>
              <Button variant="hero" className="flex-1" onClick={() => setResultOpen(false)}>
                Review Answers
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ---------- ACTIVE (quiz in progress) ----------
  const q = questions[current];
  const pct = ((current + 1) / questions.length) * 100;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const timeLow = secondsLeft <= 60;
  const allAnswered = answeredCount === questions.length;

  const handleSubmitClick = () => {
    setConfirmOpen(true);
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        {/* Top bar: timer + progress */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="capitalize flex items-center gap-1.5 text-sm text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary-glow" /> {difficulty} • {pdfTitle}
          </span>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold",
                hintsUsed >= MAX_HINTS
                  ? "border-border/50 bg-surface/40 text-muted-foreground"
                  : "border-warning/40 bg-warning/10 text-warning",
              )}
              title="Hints available for this quiz"
            >
              <Lightbulb className="h-3.5 w-3.5" />
              Hints left: {MAX_HINTS - hintsUsed}
            </span>
            <div
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-mono font-semibold border",
                timeLow
                  ? "bg-destructive/15 border-destructive/40 text-destructive animate-pulse"
                  : "bg-surface/60 border-border/60",
              )}
            >
              <Clock className="h-4 w-4" />
              {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Question {current + 1} / {questions.length}
          </span>
          <span>
            {answeredCount} / {questions.length} answered
          </span>
        </div>
        <div className="mt-1.5 h-1.5 bg-surface rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-primary transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Question card */}
        <div
          className={cn(
            "mt-6 rounded-3xl bg-gradient-card border border-border/60 p-6 sm:p-8 shadow-card",
            reaction === "wrong" && "animate-shake",
          )}
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <h2 className="text-xl font-semibold leading-relaxed flex-1 min-w-0">{q.question}</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={useHint}
              disabled={hintsUsed >= MAX_HINTS || !!hintRemoved[current]?.length}
              className="shrink-0"
              title={
                hintsUsed >= MAX_HINTS
                  ? "No hints remaining"
                  : hintRemoved[current]?.length
                    ? "Hint already used on this question"
                    : "Remove two incorrect options"
              }
            >
              <Lightbulb className="h-4 w-4 text-warning" />
              {hintsUsed >= MAX_HINTS ? "No hints remaining" : `Hint • ${MAX_HINTS - hintsUsed} left`}
            </Button>
          </div>

          {!isDailyMode && (
            <p className="mt-3 text-xs text-muted-foreground">
              🔒 Answers are locked after selection
            </p>
          )}

          <div className="mt-6 space-y-3">
            {q.options.map((opt, i) => {
              const isSelected = answers[current] === i;
              const isAnswered = answers[current] !== null && answers[current] !== undefined;
              const isRemoved = hintRemoved[current]?.includes(i);
              const showCorrect = isDailyMode && reaction === "correct" && isSelected;
              const showWrong = isDailyMode && reaction === "wrong" && isSelected;
              if (isRemoved) {
                return (
                  <div
                    key={i}
                    className="w-full text-left rounded-xl border border-dashed border-border/40 px-4 py-3.5 opacity-40 line-through select-none"
                    aria-disabled="true"
                  >
                    <span className="flex items-center gap-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border text-xs font-medium">
                        {String.fromCharCode(65 + i)}
                      </span>
                      <span>{opt}</span>
                    </span>
                  </div>
                );
              }
              return (
                <button
                  key={i}
                  onClick={() => selectAnswer(i)}
                  disabled={isAnswered}
                  className={cn(
                    "w-full text-left rounded-xl border px-4 py-3.5 transition-all duration-200",
                    isAnswered && !isSelected && "opacity-60 cursor-not-allowed",
                    isAnswered && isSelected && "cursor-default",
                    showCorrect &&
                      "border-success bg-success/15 text-success animate-correct",
                    showWrong && "border-destructive bg-destructive/15 text-destructive",
                    !showCorrect && !showWrong && isSelected
                      ? "border-primary bg-primary/10 ring-glow"
                      : !showCorrect && !showWrong &&
                          "border-border/60 hover:border-border hover:bg-surface/40",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-full border text-xs font-medium",
                        isSelected && !showCorrect && !showWrong &&
                          "border-primary bg-primary text-primary-foreground",
                        showCorrect && "border-success bg-success text-primary-foreground",
                        showWrong && "border-destructive bg-destructive text-primary-foreground",
                      )}
                    >
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span>{opt}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
            <Button variant="outline" onClick={goPrev} disabled={current === 0}>
              <ArrowLeft className="h-4 w-4" /> Previous
            </Button>

            <Button
              variant={marked[current] ? "secondary" : "ghost"}
              size="sm"
              onClick={toggleMark}
              className={cn(
                marked[current] && "border border-warning/40 bg-warning/15 text-warning hover:bg-warning/20",
              )}
            >
              {marked[current] ? (
                <>
                  <BookmarkCheck className="h-4 w-4" /> Marked
                </>
              ) : (
                <>
                  <Bookmark className="h-4 w-4" /> Mark for review
                </>
              )}
            </Button>

            {current < questions.length - 1 ? (
              <Button variant="hero" onClick={goNext}>
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button variant="hero" onClick={handleSubmitClick}>
                Submit Quiz
              </Button>
            )}
          </div>

          {!allAnswered && current === questions.length - 1 && (
            <div className="mt-4 flex items-center gap-2 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              {questions.length - answeredCount} question(s) still unanswered.
            </div>
          )}
        </div>

        {/* Question palette */}
        <div className="mt-6 rounded-2xl bg-gradient-card border border-border/60 p-4">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Question palette
            </p>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <LegendDot className="bg-success/30 border-success/50" label={`${answeredCount} answered`} />
              <LegendDot className="bg-warning/25 border-warning/50" label={`${markedCount} marked`} />
              <LegendDot
                className="bg-surface/40 border-border/40"
                label={`${questions.length - answeredCount} left`}
              />
            </div>
          </div>
          <div className="grid grid-cols-10 gap-1.5">
            {questions.map((_, i) => {
              const answered = answers[i] !== null;
              const isMarked = marked[i];
              const isCurrent = i === current;
              return (
                <button
                  key={i}
                  onClick={() => setCurrent(i)}
                  title={
                    isMarked
                      ? "Marked for review"
                      : answered
                        ? "Answered"
                        : "Not answered"
                  }
                  className={cn(
                    "relative h-8 rounded-md text-xs font-medium border transition-all",
                    isCurrent && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                    // Priority: marked > answered > none
                    isMarked &&
                      "border-warning/50 bg-warning/20 text-warning hover:bg-warning/30",
                    !isMarked &&
                      answered &&
                      "border-success/50 bg-success/15 text-success hover:bg-success/25",
                    !isMarked &&
                      !answered &&
                      "border-border/40 bg-surface/40 text-muted-foreground hover:bg-surface",
                  )}
                >
                  {i + 1}
                  {isMarked && (
                    <Bookmark className="absolute -top-1 -right-1 h-3 w-3 fill-warning text-warning" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </main>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="rounded-2xl border-border/60 bg-gradient-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit Quiz?</DialogTitle>
            <DialogDescription>
              You have answered <span className="text-foreground font-medium">{answeredCount}</span>{" "}
              out of {questions.length} questions. Once submitted, you cannot change your answers.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-2 py-1">
            <Stat label="Total" value={questions.length} tone="neutral" />
            <Stat label="Answered" value={answeredCount} tone={allAnswered ? "success" : "neutral"} />
            <Stat label="Time" value="20 min" tone="neutral" />
          </div>

          {!allAnswered && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                You still have {questions.length - answeredCount} unanswered question(s). They will be marked wrong if you submit now.
              </span>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button variant="hero" onClick={() => submitQuiz(false)} className="flex-1">
              Yes, Submit Quiz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoCard({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-surface/40 p-4 text-left">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-base font-semibold", capitalize && "capitalize")}>{value}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "success" | "destructive" | "neutral";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        tone === "success" && "border-success/40 bg-success/10 text-success",
        tone === "destructive" && "border-destructive/40 bg-destructive/10 text-destructive",
        tone === "neutral" && "border-border/60 bg-surface/40 text-foreground",
      )}
    >
      <div className="text-xs opacity-80">{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}

function formatDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-2.5 w-2.5 rounded-sm border", className)} />
      {label}
    </span>
  );
}

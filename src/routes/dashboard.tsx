import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Navbar } from "@/components/navbar";
import { ProtectedRoute } from "@/components/protected-route";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2,
  FileText,
  Sparkles,
  TrendingUp,
  Award,
  BookOpen,
  Target,
  AlertTriangle,
  History,
  Crosshair,
  ArrowRight,
  Flame,
  CheckCircle2,
  Trophy,
  Medal,
  Star,
  Zap,
  Swords,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { levelFromXp, startOfWeek, endOfWeek } from "@/lib/gamification";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/dashboard")({
  component: () => (
    <ProtectedRoute requireRole="student">
      <Dashboard />
    </ProtectedRoute>
  ),
});

interface Course { id: string; name: string }
interface Semester { id: string; name: string; course_id: string }
interface Subject { id: string; name: string; semester_id: string }
interface Unit { id: string; name: string; subject_id: string }
interface Pdf { id: string; title: string; storage_path: string; unit_id: string }
interface Attempt {
  id: string;
  pdf_id: string;
  unit_id: string;
  difficulty: string;
  score: number;
  total: number;
  created_at: string;
  mode?: string | null;
  details?: any;
  // Joined / enriched on the client
  subject_name?: string | null;
  unit_name?: string | null;
}

function Dashboard() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [pdfs, setPdfs] = useState<Pdf[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [courseId, setCourseId] = useState<string>("");
  const [semesterId, setSemesterId] = useState<string>("");
  const [subjectId, setSubjectId] = useState<string>("");
  const [unitId, setUnitId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [xp, setXp] = useState<number>(0);
  const [weeklyRank, setWeeklyRank] = useState<number | null>(null);

  // Daily quiz personalization: derived purely from the student's attempt history.

  useEffect(() => {
    (async () => {
      try {
        const [c, a] = await Promise.all([
          supabase.from("courses").select("*").order("created_at"),
          // Pull a wider history (not just 20) so analytics are meaningful.
          supabase
            .from("attempts")
            .select("id, pdf_id, unit_id, difficulty, score, total, created_at, mode, details")
            .eq("user_id", user!.id)
            .order("created_at", { ascending: false })
            .limit(200),
        ]);
        if (c.error) throw c.error;
        if (a.error) throw a.error;
        setCourses(c.data ?? []);

        const rawAttempts = (a.data ?? []) as Attempt[];

        // Enrich each attempt with its subject + unit names (for analytics + Focus Mode).
        const unitIds = Array.from(new Set(rawAttempts.map((x) => x.unit_id).filter(Boolean)));
        const subjectByUnit = new Map<string, string>();
        const unitNameById = new Map<string, string>();
        if (unitIds.length > 0) {
          const { data: us } = await supabase
            .from("units")
            .select("id, name, subject_id, subjects(name)")
            .in("id", unitIds);
          (us ?? []).forEach((u: any) => {
            subjectByUnit.set(u.id, u.subjects?.name ?? null);
            unitNameById.set(u.id, u.name ?? null);
          });
        }
        const enriched = rawAttempts.map((x) => ({
          ...x,
          subject_name: subjectByUnit.get(x.unit_id) ?? null,
          unit_name: unitNameById.get(x.unit_id) ?? null,
        }));

        setAttempts(enriched);

        // Daily quiz is personalized: only generated from units the student has
        // already attempted. We intentionally do NOT fall back to a random PDF.
      } catch (err: any) {
        console.error("[Dashboard] load failed", err);
        toast.error("Couldn't load your dashboard. Please refresh.");
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  // Fetch XP + compute weekly avg-score rank (best-effort, non-blocking)
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const wkStart = startOfWeek().toISOString();
        const wkEnd = endOfWeek().toISOString();
        const [profRes, weekRes] = await Promise.all([
          supabase.from("profiles").select("xp").eq("id", user.id).maybeSingle(),
          supabase
            .from("attempts")
            .select("user_id, score, total")
            .gte("created_at", wkStart)
            .lt("created_at", wkEnd),
        ]);
        if (profRes.data) setXp(profRes.data.xp ?? 0);
        const rows = (weekRes.data ?? []) as { user_id: string; score: number; total: number }[];
        if (rows.length === 0) {
          setWeeklyRank(null);
          return;
        }
        const byUser = new Map<string, { sum: number; count: number }>();
        rows.forEach((r) => {
          const cur = byUser.get(r.user_id) ?? { sum: 0, count: 0 };
          cur.sum += (r.score / r.total) * 100;
          cur.count += 1;
          byUser.set(r.user_id, cur);
        });
        const ranked = Array.from(byUser.entries())
          .map(([uid, v]) => ({ uid, avg: v.sum / v.count }))
          .sort((a, b) => b.avg - a.avg);
        const myIdx = ranked.findIndex((r) => r.uid === user.id);
        setWeeklyRank(myIdx >= 0 ? myIdx + 1 : null);
      } catch (err) {
        console.error("[Dashboard] xp/rank load failed", err);
      }
    })();
  }, [user]);

  useEffect(() => {
    if (!courseId) { setSemesters([]); setSemesterId(""); return; }
    supabase.from("semesters").select("*").eq("course_id", courseId).order("position")
      .then(({ data }) => setSemesters((data ?? []) as Semester[]));
  }, [courseId]);

  useEffect(() => {
    if (!semesterId) { setSubjects([]); setSubjectId(""); return; }
    supabase.from("subjects").select("*").eq("semester_id", semesterId).order("name")
      .then(({ data }) => setSubjects((data ?? []) as Subject[]));
  }, [semesterId]);

  useEffect(() => {
    if (!subjectId) { setUnits([]); setUnitId(""); return; }
    supabase.from("units").select("*").eq("subject_id", subjectId).order("position")
      .then(({ data }) => setUnits((data ?? []) as Unit[]));
  }, [subjectId]);

  useEffect(() => {
    if (!unitId) { setPdfs([]); return; }
    supabase.from("pdfs").select("*").eq("unit_id", unitId).order("created_at")
      .then(({ data }) => setPdfs((data ?? []) as Pdf[]));
  }, [unitId]);

  // ---------- Challenge Mode: fetch top-score on leaderboard for current unit ----------
  const [challengeLevel, setChallengeLevel] = useState<"beginner" | "intermediate" | "pro">("beginner");
  const [topScoreForUnit, setTopScoreForUnit] = useState<number | null>(null);

  useEffect(() => {
    if (!unitId) {
      setTopScoreForUnit(null);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("attempts")
        .select("score, total")
        .eq("unit_id", unitId)
        .eq("difficulty", challengeLevel as any)
        .order("score", { ascending: false })
        .limit(100);
      const rows = data ?? [];
      if (rows.length === 0) {
        setTopScoreForUnit(null);
        return;
      }
      const topPct = Math.max(
        ...rows.map((r: any) => Math.round((r.score / r.total) * 100)),
      );
      setTopScoreForUnit(topPct);
    })();
  }, [unitId, challengeLevel]);

  // Previous best for current user on selected unit + level
  const previousBestForUnit = useMemo(() => {
    if (!unitId) return null;
    const mine = attempts.filter(
      (a) => a.unit_id === unitId && a.difficulty === challengeLevel,
    );
    if (mine.length === 0) return null;
    return Math.max(...mine.map((a) => Math.round((a.score / a.total) * 100)));
  }, [attempts, unitId, challengeLevel]);

  // Challenge stats for the dashboard strip
  const challengeStats = useMemo(() => {
    const list = attempts.filter(
      (a) => a.mode === "challenge_std" || a.mode === "challenge_speed",
    );
    // attempts type doesn't include details; safely access via any
    const wins = list.filter((a: any) => (a as any)?.details?.challenge_won === true).length;
    return { total: list.length, wins };
  }, [attempts]);

  // Compute level unlocking by pdf
  const levelMap = new Map<string, { intermediate: boolean; pro: boolean }>();
  attempts.forEach((a) => {
    const cur = levelMap.get(a.pdf_id) ?? { intermediate: false, pro: false };
    const pct = (a.score / a.total) * 100;
    if (a.difficulty === "beginner" && pct >= 60) cur.intermediate = true;
    if (a.difficulty === "intermediate" && pct >= 60) cur.pro = true;
    levelMap.set(a.pdf_id, cur);
  });

  const totalAttempts = attempts.length;
  const avgScore = attempts.length
    ? Math.round((attempts.reduce((s, a) => s + (a.score / a.total) * 100, 0) / attempts.length))
    : 0;
  const bestScore = attempts.length
    ? Math.max(...attempts.map((a) => Math.round((a.score / a.total) * 100)))
    : 0;
  // attempts are ordered desc by created_at — first item is most recent.
  const lastAttemptScore =
    attempts.length > 0 ? Math.round((attempts[0].score / attempts[0].total) * 100) : null;

  // Strong / weak subject analysis: average % per subject (need >= 1 attempt).
  const { strongSubjects, weakSubjects } = useMemo(() => {
    const bySubject = new Map<string, { total: number; count: number }>();
    attempts.forEach((a) => {
      const name = a.subject_name;
      if (!name) return;
      const pct = (a.score / a.total) * 100;
      const cur = bySubject.get(name) ?? { total: 0, count: 0 };
      cur.total += pct;
      cur.count += 1;
      bySubject.set(name, cur);
    });
    const ranked = Array.from(bySubject.entries()).map(([name, v]) => ({
      name,
      avg: Math.round(v.total / v.count),
      attempts: v.count,
    }));
    return {
      strongSubjects: ranked
        .filter((r) => r.avg >= 75)
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 3),
      weakSubjects: ranked
        .filter((r) => r.avg < 60)
        .sort((a, b) => a.avg - b.avg)
        .slice(0, 3),
    };
  }, [attempts]);

  // ---------- Focus Mode ----------
  // Weak units = avg < 60% across all attempts for that unit.
  // Pick the weakest one and surface its most-attempted PDF as the focus target.
  const focusData = useMemo(() => {
    const byUnit = new Map<
      string,
      {
        unitId: string;
        unitName: string | null;
        subjectName: string | null;
        total: number;
        count: number;
        pdfCounts: Map<string, number>;
      }
    >();
    attempts.forEach((a) => {
      if (!a.unit_id) return;
      const cur = byUnit.get(a.unit_id) ?? {
        unitId: a.unit_id,
        unitName: a.unit_name ?? null,
        subjectName: a.subject_name ?? null,
        total: 0,
        count: 0,
        pdfCounts: new Map<string, number>(),
      };
      cur.total += (a.score / a.total) * 100;
      cur.count += 1;
      cur.pdfCounts.set(a.pdf_id, (cur.pdfCounts.get(a.pdf_id) ?? 0) + 1);
      byUnit.set(a.unit_id, cur);
    });
    const weakUnits = Array.from(byUnit.values())
      .map((u) => ({ ...u, avg: Math.round(u.total / u.count) }))
      .filter((u) => u.avg < 60)
      .sort((a, b) => a.avg - b.avg);

    const target = weakUnits[0] ?? null;
    let targetPdfId: string | null = null;
    if (target) {
      let bestPdf: string | null = null;
      let bestCount = 0;
      target.pdfCounts.forEach((count, pdfId) => {
        if (count > bestCount) {
          bestCount = count;
          bestPdf = pdfId;
        }
      });
      targetPdfId = bestPdf;
    }

    // Improvement: avg of focus-mode attempts vs standard attempts overall.
    const focusAttempts = attempts.filter((a) => a.mode === "focus");
    const standardAttempts = attempts.filter((a) => a.mode !== "focus");
    const avgPct = (xs: Attempt[]) =>
      xs.length === 0
        ? null
        : Math.round(xs.reduce((s, x) => s + (x.score / x.total) * 100, 0) / xs.length);
    const focusAvg = avgPct(focusAttempts);
    const baselineAvg = avgPct(standardAttempts);
    const improvement =
      focusAvg !== null && baselineAvg !== null ? focusAvg - baselineAvg : null;

    return {
      weakUnits: weakUnits.slice(0, 3),
      target,
      targetPdfId,
      focusCount: focusAttempts.length,
      focusAvg,
      improvement,
    };
  }, [attempts]);

  // ---------- Streak (consecutive days with at least one attempt) ----------
  const streakData = useMemo(() => {
    if (attempts.length === 0) {
      return { current: 0, best: 0, completedToday: false };
    }
    // Use the user's local timezone for "day" boundaries.
    const dayKey = (iso: string) => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const today = new Date();
    const todayKey = dayKey(today.toISOString());
    const yesterdayKey = (() => {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return dayKey(y.toISOString());
    })();

    const days = new Set(attempts.map((a) => dayKey(a.created_at)));
    const completedToday = days.has(todayKey);
    const completedYesterday = days.has(yesterdayKey);

    // Current streak: walk backwards day-by-day from today (or yesterday if
    // today isn't done yet) until a gap appears.
    let current = 0;
    if (completedToday || completedYesterday) {
      const cursor = new Date(today);
      if (!completedToday) cursor.setDate(cursor.getDate() - 1);
      while (days.has(dayKey(cursor.toISOString()))) {
        current += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
    }

    // Best streak: scan all unique days sorted ascending and find the longest run.
    const sortedDays = Array.from(days).sort();
    let best = 0;
    let run = 0;
    let prev: string | null = null;
    for (const k of sortedDays) {
      if (prev) {
        const p = new Date(prev);
        p.setDate(p.getDate() + 1);
        if (dayKey(p.toISOString()) === k) {
          run += 1;
        } else {
          run = 1;
        }
      } else {
        run = 1;
      }
      if (run > best) best = run;
      prev = k;
    }

    return { current, best: Math.max(best, current), completedToday };
  }, [attempts]);

  // ---------- Daily Quiz: attempted-unit candidates ----------
  // Personalized: questions only come from units the student has already
  // attempted. Most recently studied unit ranks first. No random fallback.
  const dailyUnits = useMemo(() => {
    const byUnit = new Map<
      string,
      { unitId: string; unitName: string; pdfId: string; lastAt: number }
    >();
    for (const a of attempts) {
      if (!a.unit_id || !a.pdf_id) continue;
      const ts = new Date(a.created_at).getTime();
      const existing = byUnit.get(a.unit_id);
      if (!existing || ts > existing.lastAt) {
        byUnit.set(a.unit_id, {
          unitId: a.unit_id,
          unitName: a.unit_name ?? "Unit",
          pdfId: a.pdf_id, // most recent attempt's pdf for this unit
          lastAt: ts,
        });
      }
    }
    return Array.from(byUnit.values()).sort((a, b) => b.lastAt - a.lastAt);
  }, [attempts]);

  // Multi-select state for daily quiz unit picker.
  const [selectedDailyUnits, setSelectedDailyUnits] = useState<Set<string>>(new Set());

  // Default-select the most recently studied unit when candidates load/change.
  useEffect(() => {
    if (dailyUnits.length === 0) {
      setSelectedDailyUnits(new Set());
      return;
    }
    setSelectedDailyUnits((prev) => {
      const valid = new Set(dailyUnits.map((u) => u.unitId));
      const next = new Set(Array.from(prev).filter((id) => valid.has(id)));
      if (next.size === 0) next.add(dailyUnits[0].unitId);
      return next;
    });
  }, [dailyUnits]);

  // The PDF to launch: most recently studied unit among the selected ones.
  const dailyPdfId = useMemo<string | null>(() => {
    if (dailyUnits.length === 0 || selectedDailyUnits.size === 0) return null;
    const chosen = dailyUnits.find((u) => selectedDailyUnits.has(u.unitId));
    return chosen?.pdfId ?? null;
  }, [dailyUnits, selectedDailyUnits]);

  const toggleDailyUnit = (unitId: string) => {
    setSelectedDailyUnits((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  const handleStartDaily = (e: React.MouseEvent) => {
    if (selectedDailyUnits.size === 0) {
      e.preventDefault();
      toast.error("Please select at least one unit to continue");
    }
  };

  // ---------- Badges ----------
  const badges = useMemo(() => {
    const passed80 = attempts.filter((a) => (a.score / a.total) * 100 >= 80).length;
    return [
      { id: "first-quiz", label: "First quiz", icon: Star, earned: attempts.length >= 1, hint: "Complete your first quiz" },
      { id: "five-quizzes", label: "5 quizzes", icon: Medal, earned: attempts.length >= 5, hint: "Complete 5 quizzes" },
      { id: "high-score", label: "High scorer", icon: Trophy, earned: passed80 >= 1, hint: "Score 80%+ on a quiz" },
      { id: "streak-3", label: "3-day streak", icon: Flame, earned: streakData.best >= 3, hint: "Practice 3 days in a row" },
      { id: "streak-7", label: "7-day streak", icon: Zap, earned: streakData.best >= 7, hint: "Practice 7 days in a row" },
    ];
  }, [attempts, streakData.best]);

  const isTopPerformer = avgScore >= 80 && totalAttempts >= 3;

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2 flex-wrap">
              Welcome back 👋
              {isTopPerformer && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary-glow"
                  title="Average score 80%+ across 3+ quizzes"
                >
                  <Trophy className="h-3 w-3" /> Top Performer
                </span>
              )}
            </h1>
            <p className="mt-1 text-muted-foreground">Pick a unit and start a quiz.</p>
          </div>
          <Button asChild variant="outline">
            <Link to="/profile">Profile</Link>
          </Button>
        </div>

        {/* Daily Quiz + Streak */}
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2 rounded-2xl bg-gradient-card border border-border/60 p-5 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 shrink-0">
                  <Sparkles className="h-5 w-5 text-primary-glow" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Daily Quiz
                  </h3>
                  <p className="mt-1.5 font-medium">
                    {streakData.completedToday
                      ? "You've done your daily quiz today — keep the streak going!"
                      : "5 quick questions to keep your streak alive."}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {dailyUnits.length === 0
                      ? "Please select a course/unit first to start daily quiz."
                      : "Pick the units to draw your 5 questions from."}
                  </p>
                </div>
              </div>

              {/* Unit picker — only when the student has prior unit activity */}
              {dailyUnits.length > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-border/60 bg-background/40 p-2">
                    {dailyUnits.map((u) => {
                      const checked = selectedDailyUnits.has(u.unitId);
                      return (
                        <label
                          key={u.unitId}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDailyUnit(u.unitId)}
                            className="h-4 w-4 accent-primary"
                          />
                          <span className="truncate">{u.unitName}</span>
                        </label>
                      );
                    })}
                  </div>
                  {selectedDailyUnits.size === 0 && (
                    <p className="text-xs text-warning">
                      Please select at least one unit to continue
                    </p>
                  )}
                  <div className="flex justify-end">
                    {dailyPdfId && selectedDailyUnits.size > 0 ? (
                      <Button
                        asChild
                        variant={streakData.completedToday ? "outline" : "hero"}
                        size="sm"
                      >
                        <Link
                          to="/quiz/$pdfId/$difficulty"
                          params={{ pdfId: dailyPdfId, difficulty: "beginner" }}
                          search={{ mode: "daily", count: 5 }}
                          onClick={handleStartDaily}
                        >
                          {streakData.completedToday ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5" /> Practice again
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-3.5 w-3.5" /> Start Daily Quiz
                              <ArrowRight className="h-3.5 w-3.5" />
                            </>
                          )}
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        variant={streakData.completedToday ? "outline" : "hero"}
                        size="sm"
                        onClick={() =>
                          toast.error("Please select at least one unit to continue")
                        }
                      >
                        <Sparkles className="h-3.5 w-3.5" /> Start Daily Quiz
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-gradient-card border border-border/60 p-5 shadow-card">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg shrink-0",
                  streakData.current > 0 ? "bg-warning/15" : "bg-muted/30",
                )}
              >
                <Flame
                  className={cn(
                    "h-5 w-5",
                    streakData.current > 0 ? "text-warning" : "text-muted-foreground",
                  )}
                />
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Current streak</div>
                <div className="text-xl font-bold">
                  {streakData.current} day{streakData.current === 1 ? "" : "s"}
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Best: {streakData.best} day{streakData.best === 1 ? "" : "s"}</span>
              {streakData.current > 0 && !streakData.completedToday && (
                <span className="text-warning font-medium">Don't break your streak!</span>
              )}
            </div>
          </div>
        </div>

        {/* Level + XP + Weekly rank */}
        <div className="mt-4 rounded-2xl bg-gradient-card border border-border/60 p-5 shadow-card">
          {(() => {
            const info = levelFromXp(xp);
            return (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-primary shadow-glow shrink-0">
                    <span className="text-lg font-bold text-primary-foreground">
                      {info.level}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                      Level {info.level}
                      {info.isMax ? " (MAX)" : ""}
                    </div>
                    <div className="font-semibold">
                      {xp} XP
                      {!info.isMax && (
                        <span className="ml-2 text-xs text-muted-foreground font-normal">
                          {info.xpForNextLevel - info.xpIntoLevel} to next level
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex-1 min-w-[160px]">
                  <Progress value={info.progressPct} className="h-2" />
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{info.xpIntoLevel} XP</span>
                    <span>{info.isMax ? "Max level" : `${info.xpForNextLevel} XP`}</span>
                  </div>
                </div>
                <Link
                  to="/leaderboard"
                  className="flex items-center gap-2 rounded-xl border border-border/60 bg-surface/40 px-3 py-2 text-sm hover:bg-accent/20 transition-colors shrink-0"
                >
                  <Trophy className="h-4 w-4 text-primary-glow" />
                  <span className="font-medium">
                    {weeklyRank ? `Rank #${weeklyRank}` : "Leaderboard"}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                </Link>
              </div>
            );
          })()}
        </div>

        {/* Stats */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={TrendingUp} label="Quizzes attempted" value={totalAttempts} />
          <StatCard icon={Sparkles} label="Average score" value={`${avgScore}%`} />
          <StatCard
            icon={History}
            label="Last attempt"
            value={lastAttemptScore !== null ? `${lastAttemptScore}%` : "—"}
          />
          <StatCard icon={Award} label="Best score" value={`${bestScore}%`} />
        </div>

        {/* Strong / weak subject breakdown */}
        {attempts.length > 0 && (strongSubjects.length > 0 || weakSubjects.length > 0) && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <SubjectListCard
              icon={Target}
              title="Strong subjects"
              tone="success"
              empty="Score 75%+ in any subject to see it here."
              subjects={strongSubjects}
            />
            <SubjectListCard
              icon={AlertTriangle}
              title="Weak subjects"
              tone="warning"
              empty="No weak areas detected. Nice work!"
              subjects={weakSubjects}
            />
          </div>
        )}

        {/* Focus Mode */}
        {focusData.target && focusData.targetPdfId && (
          <div className="mt-4 rounded-2xl bg-gradient-card border border-warning/40 p-5 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/15 shrink-0">
                  <Crosshair className="h-5 w-5 text-warning" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Focus Mode
                    </h3>
                    <span className="rounded-md bg-warning/15 border border-warning/30 px-2 py-0.5 text-[10px] font-semibold text-warning">
                      Suggested
                    </span>
                  </div>
                  <p className="mt-1.5 font-medium truncate">
                    Focus on{" "}
                    <span className="text-warning">
                      {focusData.target.unitName ?? "this unit"}
                    </span>{" "}
                    to improve your score
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {focusData.target.subjectName ? `${focusData.target.subjectName} • ` : ""}
                    Current avg {focusData.target.avg}% across {focusData.target.count}{" "}
                    {focusData.target.count === 1 ? "attempt" : "attempts"}
                  </p>

                  {focusData.weakUnits.length > 1 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {focusData.weakUnits.slice(1).map((u) => (
                        <span
                          key={u.unitId}
                          className="rounded-md border border-border/40 bg-surface/40 px-2 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {u.unitName ?? "Unit"} • {u.avg}%
                        </span>
                      ))}
                    </div>
                  )}

                  {focusData.focusCount > 0 && (
                    <p className="mt-2 text-xs">
                      <span className="text-muted-foreground">
                        Focus attempts: {focusData.focusCount} • Avg {focusData.focusAvg}%
                      </span>
                      {focusData.improvement !== null && (
                        <span
                          className={cn(
                            "ml-2 font-semibold",
                            focusData.improvement >= 0 ? "text-success" : "text-destructive",
                          )}
                        >
                          {focusData.improvement >= 0 ? "+" : ""}
                          {focusData.improvement}% vs standard
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
              <Button asChild variant="hero" size="sm" className="shrink-0">
                <Link
                  to="/quiz/$pdfId/$difficulty"
                  params={{ pdfId: focusData.targetPdfId, difficulty: "beginner" }}
                  search={{ mode: "focus" }}
                >
                  <Crosshair className="h-3.5 w-3.5" /> Start Focus Quiz
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        )}

        {/* Selectors */}
        <div className="mt-8 rounded-2xl bg-gradient-card border border-border/60 p-6 shadow-card">
          <h2 className="text-lg font-semibold mb-4">Find your unit</h2>
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading courses">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i}>
                  <div className="h-3 w-20 rounded bg-primary/10 animate-pulse" />
                  <div className="mt-2 h-10 rounded-md bg-primary/10 animate-pulse" />
                </div>
              ))}
            </div>
          ) : courses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No courses available yet. Ask your admin to upload course material.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Selector label="Course" value={courseId} onChange={setCourseId} options={courses} />
              <Selector label="Semester" value={semesterId} onChange={setSemesterId} options={semesters} disabled={!courseId} />
              <Selector label="Subject" value={subjectId} onChange={setSubjectId} options={subjects} disabled={!semesterId} />
              <Selector label="Unit" value={unitId} onChange={setUnitId} options={units} disabled={!subjectId} />
            </div>
          )}
        </div>

        {/* PDFs */}
        {unitId && (
          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-3">PDFs in this unit</h2>
            {pdfs.length === 0 ? (
              <div className="rounded-2xl bg-gradient-card border border-border/60 p-8 text-center">
                <FileText className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">
                  No PDFs uploaded for this unit yet.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {pdfs.map((pdf) => {
                  const levels = levelMap.get(pdf.id) ?? { intermediate: false, pro: false };
                  const courseName = courses.find((c) => c.id === courseId)?.name;
                  const semesterName = semesters.find((s) => s.id === semesterId)?.name;
                  const subjectName = subjects.find((s) => s.id === subjectId)?.name;
                  const unitName = units.find((u) => u.id === unitId)?.name;
                  return (
                    <div
                      key={pdf.id}
                      className="rounded-2xl bg-gradient-card border border-border/60 p-5 shadow-card hover:shadow-glow transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20 shrink-0">
                          <FileText className="h-5 w-5 text-primary-glow" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium truncate">{pdf.title}</h3>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                            {[courseName, semesterName, subjectName, unitName]
                              .filter(Boolean)
                              .map((seg, i) => (
                                <span
                                  key={i}
                                  className="rounded-md bg-surface/60 border border-border/40 px-1.5 py-0.5"
                                >
                                  {seg}
                                </span>
                              ))}
                          </div>

                          <p className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">
                            Start Quiz
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            <LevelButton pdfId={pdf.id} level="beginner" enabled />
                            <LevelButton pdfId={pdf.id} level="intermediate" enabled={levels.intermediate} />
                            <LevelButton pdfId={pdf.id} level="pro" enabled={levels.pro} />
                          </div>

                          <Button asChild variant="ghost" size="sm" className="mt-3 -ml-2">
                            <Link to="/pdf/$pdfId" params={{ pdfId: pdf.id }}>
                              <BookOpen className="h-3.5 w-3.5" /> View PDF
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Challenge Mode */}
        {unitId && pdfs.length > 0 && (
          <div className="mt-6 rounded-2xl bg-gradient-card border border-border/60 p-5 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 shrink-0">
                  <Swords className="h-5 w-5 text-primary-glow" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold flex items-center gap-2 flex-wrap">
                    Challenge Mode
                    {challengeStats.total > 0 && (
                      <span className="rounded-md bg-primary/10 border border-primary/30 px-2 py-0.5 text-[10px] font-semibold text-primary-glow">
                        {challengeStats.wins}/{challengeStats.total} won
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Beat a target, then see if you can hold it under pressure.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-surface/40 p-1">
                {(["beginner", "intermediate", "pro"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setChallengeLevel(lvl)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors",
                      challengeLevel === lvl
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <ChallengeCard
                icon={Trophy}
                label="Beat Your Previous Score"
                valueLabel="Your best"
                value={previousBestForUnit !== null ? `${previousBestForUnit}%` : "—"}
                cta="Beat Your Score"
                disabled={previousBestForUnit === null}
                disabledHint="Complete a quiz on this unit first."
                pdfId={pdfs[0].id}
                difficulty={challengeLevel}
                challengeType="previous"
                target={previousBestForUnit ?? 0}
              />
              <ChallengeCard
                icon={Medal}
                label="Beat Top Scorer"
                valueLabel="Leaderboard top"
                value={topScoreForUnit !== null ? `${topScoreForUnit}%` : "—"}
                cta="Beat Top Score"
                disabled={topScoreForUnit === null}
                disabledHint="No leaderboard score for this unit yet."
                pdfId={pdfs[0].id}
                difficulty={challengeLevel}
                challengeType="top"
                target={topScoreForUnit ?? 0}
              />
              <ChallengeCard
                icon={Timer}
                label="Speed Challenge"
                valueLabel="Timer"
                value="10 min"
                cta="Start Speed Challenge"
                disabled={false}
                pdfId={pdfs[0].id}
                difficulty={challengeLevel}
                challengeType="speed"
                target={Math.max(previousBestForUnit ?? 0, topScoreForUnit ?? 0, 60)}
                time={10}
              />
            </div>
          </div>
        )}

        {/* Badges */}
        <div className="mt-10">
          <h2 className="text-lg font-semibold mb-3">Achievements</h2>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {badges.map((b) => {
              const Icon = b.icon;
              return (
                <div
                  key={b.id}
                  className={cn(
                    "rounded-xl border p-4 text-center transition-all",
                    b.earned
                      ? "bg-gradient-card border-primary/40 shadow-card"
                      : "bg-surface/30 border-border/40 opacity-60",
                  )}
                  title={b.hint}
                >
                  <div
                    className={cn(
                      "mx-auto flex h-10 w-10 items-center justify-center rounded-full",
                      b.earned ? "bg-primary/15" : "bg-muted/30",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-5 w-5",
                        b.earned ? "text-primary-glow" : "text-muted-foreground",
                      )}
                    />
                  </div>
                  <div className="mt-2 text-xs font-semibold">{b.label}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {b.earned ? "Earned" : b.hint}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent attempts */}
        {attempts.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-semibold mb-3">Recent attempts</h2>
            <div className="rounded-2xl bg-gradient-card border border-border/60 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-border/60 text-muted-foreground">
                  <tr>
                    <th className="text-left p-4 font-medium">When</th>
                    <th className="text-left p-4 font-medium">Difficulty</th>
                    <th className="text-left p-4 font-medium">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.slice(0, 10).map((a) => {
                    const pct = Math.round((a.score / a.total) * 100);
                    return (
                      <tr key={a.id} className="border-b border-border/30 last:border-0">
                        <td className="p-4">{new Date(a.created_at).toLocaleString()}</td>
                        <td className="p-4 capitalize">{a.difficulty}</td>
                        <td className="p-4">
                          <span className={cn("font-semibold", pct >= 80 ? "text-success" : pct >= 60 ? "text-warning" : "text-destructive")}>
                            {a.score}/{a.total} ({pct}%)
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-gradient-card border border-border/60 p-5 shadow-card">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20">
          <Icon className="h-5 w-5 text-primary-glow" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-bold">{value}</div>
        </div>
      </div>
    </div>
  );
}

function SubjectListCard({
  icon: Icon,
  title,
  tone,
  subjects,
  empty,
}: {
  icon: any;
  title: string;
  tone: "success" | "warning";
  subjects: { name: string; avg: number; attempts: number }[];
  empty: string;
}) {
  return (
    <div className="rounded-2xl bg-gradient-card border border-border/60 p-5 shadow-card">
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            "h-4 w-4",
            tone === "success" ? "text-success" : "text-warning",
          )}
        />
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
      </div>
      {subjects.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {subjects.map((s) => (
            <li
              key={s.name}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-surface/30 px-3 py-2 text-sm"
            >
              <span className="truncate">{s.name}</span>
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-xs font-semibold",
                  tone === "success"
                    ? "bg-success/15 text-success border border-success/30"
                    : "bg-warning/15 text-warning border border-warning/30",
                )}
              >
                {s.avg}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface SelectorProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
  disabled?: boolean;
}

function Selector(props: SelectorProps) {
  const { label, value, onChange, options, disabled } = props;
  return (
    <div>
      <label className="text-xs uppercase tracking-wide text-muted-foreground font-medium">{label}</label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="mt-1">
          <SelectValue placeholder={disabled ? `Select ${label.toLowerCase()}…` : `Choose…`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function LevelButton({ pdfId, level, enabled }: { pdfId: string; level: "beginner" | "intermediate" | "pro"; enabled: boolean }) {
  if (!enabled) {
    return (
      <button
        disabled
        onClick={() => toast.info("Score 60%+ on the previous level to unlock")}
        className="rounded-md border border-border/40 px-3 py-1 text-xs text-muted-foreground/60 cursor-not-allowed capitalize"
        title="Locked — score 60%+ on the previous level"
      >
        🔒 {level}
      </button>
    );
  }
  return (
    <Link
      to="/quiz/$pdfId/$difficulty"
      params={{ pdfId, difficulty: level }}
      className={cn(
        "rounded-md px-3 py-1 text-xs font-medium capitalize transition-all hover:scale-105",
        level === "beginner" && "bg-success/20 text-success border border-success/30",
        level === "intermediate" && "bg-warning/20 text-warning border border-warning/30",
        level === "pro" && "bg-gradient-primary text-primary-foreground shadow-glow"
      )}
    >
      {level}
    </Link>
  );
}

function ChallengeCard({
  icon: Icon,
  label,
  valueLabel,
  value,
  cta,
  disabled,
  disabledHint,
  pdfId,
  difficulty,
  challengeType,
  target,
  time,
}: {
  icon: any;
  label: string;
  valueLabel: string;
  value: string;
  cta: string;
  disabled: boolean;
  disabledHint?: string;
  pdfId: string;
  difficulty: "beginner" | "intermediate" | "pro";
  challengeType: "previous" | "top" | "speed";
  target: number;
  time?: number;
}) {
  const search: {
    mode: "challenge";
    challengeType: "previous" | "top" | "speed";
    target: number;
    time?: number;
  } = { mode: "challenge", challengeType, target };
  if (time) search.time = time;
  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-all",
        disabled
          ? "border-border/40 bg-surface/30 opacity-70"
          : "border-border/60 bg-surface/40 hover:shadow-card hover:border-primary/40",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 shrink-0">
          <Icon className="h-4 w-4 text-primary-glow" />
        </div>
        <div className="text-sm font-semibold">{label}</div>
      </div>
      <div className="mt-3 text-[11px] uppercase tracking-wide text-muted-foreground">
        {valueLabel}
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {disabled ? (
        <p className="mt-3 text-[11px] text-muted-foreground">{disabledHint}</p>
      ) : (
        <Button asChild variant="hero" size="sm" className="mt-3 w-full">
          <Link
            to="/quiz/$pdfId/$difficulty"
            params={{ pdfId, difficulty }}
            search={search}
          >
            {cta} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      )}
    </div>
  );
}

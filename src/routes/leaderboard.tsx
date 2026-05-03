import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Navbar } from "@/components/navbar";
import { ProtectedRoute } from "@/components/protected-route";
import { BackButton } from "@/components/back-button";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Trophy,
  Flame,
  TrendingUp,
  Zap,
  Loader2,
  Crown,
  Medal,
  UserRound,
  Swords,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { startOfWeek, endOfWeek, levelFromXp } from "@/lib/gamification";

export const Route = createFileRoute("/leaderboard")({
  component: () => (
    <ProtectedRoute>
      <LeaderboardPage />
    </ProtectedRoute>
  ),
});

interface ProfileLite {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  xp: number;
  level: number;
}

interface AttemptLite {
  user_id: string;
  score: number;
  total: number;
  created_at: string;
  mode?: string | null;
  details?: any;
}

interface XpEvent {
  user_id: string;
  amount: number;
  created_at: string;
}

interface Row {
  userId: string;
  name: string;
  avatarUrl: string | null;
  level: number;
  value: number; // primary metric
  display: string;
}

function LeaderboardPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Map<string, ProfileLite>>(new Map());
  const [thisWeekAttempts, setThisWeekAttempts] = useState<AttemptLite[]>([]);
  const [lastWeekAttempts, setLastWeekAttempts] = useState<AttemptLite[]>([]);
  const [thisWeekXp, setThisWeekXp] = useState<XpEvent[]>([]);
  const [allAttemptsForStreak, setAllAttemptsForStreak] = useState<AttemptLite[]>([]);

  const weekStart = useMemo(() => startOfWeek(), []);
  const weekEnd = useMemo(() => endOfWeek(), []);
  const lastWeekStart = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    return d;
  }, [weekStart]);

  useEffect(() => {
    (async () => {
      try {
        const [tw, lw, xp, all, profs] = await Promise.all([
          supabase
            .from("attempts")
            .select("user_id, score, total, created_at, mode, details")
            .gte("created_at", weekStart.toISOString())
            .lt("created_at", weekEnd.toISOString()),
          supabase
            .from("attempts")
            .select("user_id, score, total, created_at")
            .gte("created_at", lastWeekStart.toISOString())
            .lt("created_at", weekStart.toISOString()),
          supabase
            .from("xp_events")
            .select("user_id, amount, created_at")
            .gte("created_at", weekStart.toISOString())
            .lt("created_at", weekEnd.toISOString()),
          // For streak calculation we need each user's attempts history.
          // Limit to the last 60 days to keep it small.
          supabase
            .from("attempts")
            .select("user_id, score, total, created_at")
            .gte(
              "created_at",
              new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
            ),
          supabase
            .from("profiles")
            .select("id, full_name, avatar_url, xp, level"),
        ]);

        if (tw.error) throw tw.error;
        if (lw.error) throw lw.error;
        if (xp.error) throw xp.error;
        if (all.error) throw all.error;
        if (profs.error) throw profs.error;

        setThisWeekAttempts((tw.data ?? []) as AttemptLite[]);
        setLastWeekAttempts((lw.data ?? []) as AttemptLite[]);
        setThisWeekXp((xp.data ?? []) as XpEvent[]);
        setAllAttemptsForStreak((all.data ?? []) as AttemptLite[]);

        const map = new Map<string, ProfileLite>();
        (profs.data ?? []).forEach((p: any) => {
          map.set(p.id, {
            id: p.id,
            full_name: p.full_name,
            avatar_url: p.avatar_url,
            xp: p.xp ?? 0,
            level: p.level ?? 1,
          });
        });
        setProfiles(map);
      } catch (err) {
        console.error("[leaderboard] load failed", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [weekStart, weekEnd, lastWeekStart]);

  const nameOf = (uid: string) =>
    profiles.get(uid)?.full_name?.trim() || "Anonymous learner";
  const avatarOf = (uid: string) => profiles.get(uid)?.avatar_url ?? null;
  const levelOf = (uid: string) => profiles.get(uid)?.level ?? 1;

  // ---------- Top Scorers (avg score % this week, min 1 attempt) ----------
  const topScorers = useMemo<Row[]>(() => {
    const byUser = new Map<string, { sum: number; count: number }>();
    thisWeekAttempts.forEach((a) => {
      const cur = byUser.get(a.user_id) ?? { sum: 0, count: 0 };
      cur.sum += (a.score / a.total) * 100;
      cur.count += 1;
      byUser.set(a.user_id, cur);
    });
    return Array.from(byUser.entries())
      .map(([uid, v]) => {
        const avg = Math.round(v.sum / v.count);
        return {
          userId: uid,
          name: nameOf(uid),
          avatarUrl: avatarOf(uid),
          level: levelOf(uid),
          value: avg,
          display: `${avg}% avg • ${v.count} quiz${v.count === 1 ? "" : "zes"}`,
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thisWeekAttempts, profiles]);

  // ---------- Top Streaks (current streak across all users) ----------
  const topStreaks = useMemo<Row[]>(() => {
    const byUser = new Map<string, Set<string>>();
    const dayKey = (iso: string) => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    allAttemptsForStreak.forEach((a) => {
      const set = byUser.get(a.user_id) ?? new Set<string>();
      set.add(dayKey(a.created_at));
      byUser.set(a.user_id, set);
    });
    const today = new Date();
    const todayKey = dayKey(today.toISOString());
    const yKey = (() => {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return dayKey(y.toISOString());
    })();
    const rows: Row[] = [];
    byUser.forEach((days, uid) => {
      if (!days.has(todayKey) && !days.has(yKey)) return; // streak broken
      let cursor = new Date(today);
      if (!days.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
      let streak = 0;
      while (days.has(dayKey(cursor.toISOString()))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
      if (streak > 0) {
        rows.push({
          userId: uid,
          name: nameOf(uid),
          avatarUrl: avatarOf(uid),
          level: levelOf(uid),
          value: streak,
          display: `${streak} day${streak === 1 ? "" : "s"} 🔥`,
        });
      }
    });
    return rows.sort((a, b) => b.value - a.value).slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAttemptsForStreak, profiles]);

  // ---------- Most Improved (this week avg vs last week avg) ----------
  const mostImproved = useMemo<Row[]>(() => {
    const avgFor = (xs: AttemptLite[]) => {
      const m = new Map<string, { sum: number; count: number }>();
      xs.forEach((a) => {
        const cur = m.get(a.user_id) ?? { sum: 0, count: 0 };
        cur.sum += (a.score / a.total) * 100;
        cur.count += 1;
        m.set(a.user_id, cur);
      });
      const out = new Map<string, number>();
      m.forEach((v, uid) => out.set(uid, v.sum / v.count));
      return out;
    };
    const tw = avgFor(thisWeekAttempts);
    const lw = avgFor(lastWeekAttempts);
    const rows: Row[] = [];
    tw.forEach((twAvg, uid) => {
      const lwAvg = lw.get(uid);
      if (lwAvg === undefined) return; // need a baseline
      const delta = Math.round(twAvg - lwAvg);
      if (delta <= 0) return;
      rows.push({
        userId: uid,
        name: nameOf(uid),
        avatarUrl: avatarOf(uid),
        level: levelOf(uid),
        value: delta,
        display: `+${delta}% (${Math.round(lwAvg)}% → ${Math.round(twAvg)}%)`,
      });
    });
    return rows.sort((a, b) => b.value - a.value).slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thisWeekAttempts, lastWeekAttempts, profiles]);

  // ---------- Top XP this week ----------
  const topXp = useMemo<Row[]>(() => {
    const byUser = new Map<string, number>();
    thisWeekXp.forEach((e) => {
      byUser.set(e.user_id, (byUser.get(e.user_id) ?? 0) + e.amount);
    });
    return Array.from(byUser.entries())
      .map(([uid, total]) => ({
        userId: uid,
        name: nameOf(uid),
        avatarUrl: avatarOf(uid),
        level: levelOf(uid),
        value: total,
        display: `${total} XP this week`,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thisWeekXp, profiles]);

  // ---------- Top Challengers (challenge wins this week) ----------
  const topChallengers = useMemo<Row[]>(() => {
    const byUser = new Map<string, { wins: number; total: number }>();
    thisWeekAttempts.forEach((a) => {
      if (a.mode !== "challenge_std" && a.mode !== "challenge_speed") return;
      const cur = byUser.get(a.user_id) ?? { wins: 0, total: 0 };
      cur.total += 1;
      if ((a.details as any)?.challenge_won === true) cur.wins += 1;
      byUser.set(a.user_id, cur);
    });
    return Array.from(byUser.entries())
      .map(([uid, v]) => ({
        userId: uid,
        name: nameOf(uid),
        avatarUrl: avatarOf(uid),
        level: levelOf(uid),
        value: v.wins,
        display: `${v.wins} win${v.wins === 1 ? "" : "s"} • ${v.total} challenge${v.total === 1 ? "" : "s"}`,
      }))
      .filter((r) => r.value > 0 || true) // keep even zero wins to show activity
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thisWeekAttempts, profiles]);

  const fmtRange = (a: Date, b: Date) => {
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${a.toLocaleDateString(undefined, opts)} – ${new Date(b.getTime() - 1).toLocaleDateString(undefined, opts)}`;
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <BackButton fallback="/dashboard" className="mb-3 -ml-2" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Trophy className="h-7 w-7 text-primary-glow" />
              Weekly Leaderboard
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {fmtRange(weekStart, weekEnd)} • Resets every Monday
            </p>
          </div>
        </div>

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-glow" />
          </div>
        ) : (
          <Tabs defaultValue="scorers" className="mt-6">
            <TabsList className="grid w-full grid-cols-3 sm:grid-cols-5">
              <TabsTrigger value="scorers" className="gap-1.5">
                <Trophy className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Top</span> Scorers
              </TabsTrigger>
              <TabsTrigger value="streaks" className="gap-1.5">
                <Flame className="h-3.5 w-3.5" />
                Streaks
              </TabsTrigger>
              <TabsTrigger value="improved" className="gap-1.5">
                <TrendingUp className="h-3.5 w-3.5" />
                Improved
              </TabsTrigger>
              <TabsTrigger value="xp" className="gap-1.5">
                <Zap className="h-3.5 w-3.5" />
                Top XP
              </TabsTrigger>
              <TabsTrigger value="challengers" className="gap-1.5">
                <Swords className="h-3.5 w-3.5" />
                Challengers
              </TabsTrigger>
            </TabsList>

            <TabsContent value="scorers">
              <Board
                rows={topScorers}
                currentUserId={user?.id ?? null}
                metricLabel="Avg score"
                empty="No quiz attempts yet this week. Be the first to claim a spot!"
              />
            </TabsContent>
            <TabsContent value="streaks">
              <Board
                rows={topStreaks}
                currentUserId={user?.id ?? null}
                metricLabel="Current streak"
                empty="No active streaks yet. Take a quiz today to get on the board!"
              />
            </TabsContent>
            <TabsContent value="improved">
              <Board
                rows={mostImproved}
                currentUserId={user?.id ?? null}
                metricLabel="Improvement"
                empty="Need quizzes from last week and this week to measure improvement."
              />
            </TabsContent>
            <TabsContent value="xp">
              <Board
                rows={topXp}
                currentUserId={user?.id ?? null}
                metricLabel="XP this week"
                empty="No XP earned yet this week."
              />
            </TabsContent>
            <TabsContent value="challengers">
              <Board
                rows={topChallengers}
                currentUserId={user?.id ?? null}
                metricLabel="Challenge wins"
                empty="No challenge wins yet this week. Head to the dashboard and start one!"
              />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}

function Board({
  rows,
  currentUserId,
  metricLabel,
  empty,
}: {
  rows: Row[];
  currentUserId: string | null;
  metricLabel: string;
  empty: string;
}) {
  const youInTop = rows.find((r) => r.userId === currentUserId);
  return (
    <div className="mt-4 space-y-2">
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-gradient-card p-10 text-center text-sm text-muted-foreground">
          {empty}
        </div>
      ) : (
        <>
          {currentUserId && !youInTop && (
            <p className="text-xs text-muted-foreground px-1">
              You're not in the top 10 yet — keep going!
            </p>
          )}
          {rows.map((r, i) => (
            <RankRow
              key={r.userId}
              row={r}
              rank={i + 1}
              isMe={r.userId === currentUserId}
              metricLabel={metricLabel}
            />
          ))}
        </>
      )}
    </div>
  );
}

function RankRow({
  row,
  rank,
  isMe,
  metricLabel,
}: {
  row: Row;
  rank: number;
  isMe: boolean;
  metricLabel: string;
}) {
  const podium = rank <= 3;
  const podiumColor =
    rank === 1
      ? "text-warning"
      : rank === 2
        ? "text-muted-foreground"
        : rank === 3
          ? "text-primary-glow"
          : "text-muted-foreground";
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3 transition-all",
        isMe
          ? "border-primary/60 bg-primary/10 shadow-glow"
          : podium
            ? "border-border/60 bg-gradient-card shadow-card"
            : "border-border/40 bg-surface/30",
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg font-bold shrink-0",
          podium ? "bg-surface/60" : "bg-surface/40",
          podiumColor,
        )}
      >
        {rank === 1 ? (
          <Crown className="h-5 w-5" />
        ) : rank === 2 || rank === 3 ? (
          <Medal className="h-5 w-5" />
        ) : (
          <span className="text-sm">#{rank}</span>
        )}
      </div>
      <div className="h-9 w-9 rounded-full overflow-hidden bg-surface/60 border border-border/40 flex items-center justify-center shrink-0">
        {row.avatarUrl ? (
          <img src={row.avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <UserRound className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{row.name}</span>
          {isMe && (
            <span className="text-[10px] uppercase tracking-wide font-semibold text-primary-glow rounded-md bg-primary/15 border border-primary/30 px-1.5 py-0.5">
              You
            </span>
          )}
          <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground rounded-md bg-surface/60 border border-border/40 px-1.5 py-0.5">
            Lv {row.level}
          </span>
        </div>
        <div className="text-xs text-muted-foreground truncate">{row.display}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {metricLabel}
        </div>
        <div className={cn("text-lg font-bold", podium && podiumColor)}>
          {row.value}
        </div>
      </div>
    </div>
  );
}

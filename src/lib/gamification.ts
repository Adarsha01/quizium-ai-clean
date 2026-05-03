// Gamification helpers — shared by quiz submit, profile, dashboard, leaderboard.
// Pure / client-safe: only uses the standard supabase client (RLS applies).

import { supabase } from "@/integrations/supabase/client";

// ---------- Levels ----------
// Cumulative XP required to *reach* a given level. Index = level - 1.
// 10 levels total. Past level 10, players keep gaining XP but stay at 10.
export const LEVEL_THRESHOLDS = [
  0,    // L1
  50,   // L2
  150,  // L3
  300,  // L4
  500,  // L5
  750,  // L6
  1050, // L7
  1400, // L8
  1800, // L9
  2250, // L10
] as const;

export const MAX_LEVEL = LEVEL_THRESHOLDS.length;

export interface LevelInfo {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number; // total span of current level (0 if maxed)
  progressPct: number; // 0..100
  isMax: boolean;
}

export function levelFromXp(xp: number): LevelInfo {
  const safeXp = Math.max(0, Math.floor(xp));
  let level = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (safeXp >= LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  const isMax = level >= MAX_LEVEL;
  const base = LEVEL_THRESHOLDS[level - 1];
  const next = isMax ? base : LEVEL_THRESHOLDS[level];
  const xpIntoLevel = safeXp - base;
  const xpForNextLevel = next - base;
  const progressPct = isMax
    ? 100
    : Math.min(100, Math.round((xpIntoLevel / xpForNextLevel) * 100));
  return { level, xpIntoLevel, xpForNextLevel, progressPct, isMax };
}

// ---------- XP rules ----------
export type QuizMode =
  | "standard"
  | "focus"
  | "daily"
  | "challenge_std"
  | "challenge_speed";

export interface XpAwardInput {
  scorePct: number; // 0..100
  mode: QuizMode;
  isPerfect: boolean; // 100%
  streakDayBonusEligible: boolean; // first quiz of a new day on a streak
  challengeWon?: boolean; // beat target — only meaningful for challenge modes
}

export interface XpAwardLine {
  amount: number;
  reason: string;
}

export function computeXpAward(input: XpAwardInput): XpAwardLine[] {
  const lines: XpAwardLine[] = [];
  const isChallenge = input.mode === "challenge_std" || input.mode === "challenge_speed";
  const isSpeed = input.mode === "challenge_speed";

  if (isChallenge) {
    // Challenge completion base
    lines.push({ amount: 20, reason: "Challenge completed" });
    if (input.challengeWon) {
      lines.push({ amount: 30, reason: "Challenge won" });
    }
    if (isSpeed && input.scorePct >= 80) {
      lines.push({ amount: 40, reason: "Speed challenge 80%+" });
    }
    if (input.isPerfect) {
      lines.push({ amount: 10, reason: "Perfect score!" });
    }
  } else {
    // Base for any completed quiz
    lines.push({ amount: 10, reason: "Quiz completed" });
    if (input.scorePct >= 80) {
      lines.push({ amount: 20, reason: "High score (80%+)" });
    }
    if (input.isPerfect) {
      lines.push({ amount: 10, reason: "Perfect score!" });
    }
    if (input.mode === "daily") {
      lines.push({ amount: 5, reason: "Daily quiz" });
    }
    if (input.mode === "focus") {
      lines.push({ amount: 5, reason: "Focus mode" });
    }
  }
  if (input.streakDayBonusEligible) {
    lines.push({ amount: 5, reason: "Streak day bonus" });
  }
  return lines;
}

// ---------- Achievements ----------
export interface AchievementCheckCtx {
  totalAttempts: number; // including the just-completed one
  highScoreCount: number; // 80%+ count, including just-completed
  bestStreak: number;
  scorePct: number;
  isPerfect: boolean;
  mode: QuizMode;
  // Challenge context (optional — only meaningful for challenge attempts)
  challengeCompletedCount?: number; // total challenges ever completed, incl. this one
  challengeWonCount?: number; // total challenges won, incl. this one if won
  challengeWon?: boolean;
}

export function achievementsToUnlock(ctx: AchievementCheckCtx): string[] {
  const keys: string[] = [];
  if (ctx.totalAttempts >= 1) keys.push("quiz_beginner");
  if (ctx.bestStreak >= 5) keys.push("consistent_learner");
  if (ctx.scorePct >= 80) keys.push("high_scorer");
  if (ctx.highScoreCount >= 5) keys.push("concept_master");
  if (ctx.bestStreak >= 10) keys.push("streak_king");
  if (ctx.mode === "focus") keys.push("focus_fighter");
  if (ctx.isPerfect) keys.push("perfectionist");
  // Challenge-mode badges
  const isChallenge = ctx.mode === "challenge_std" || ctx.mode === "challenge_speed";
  if (isChallenge && (ctx.challengeCompletedCount ?? 0) >= 1) keys.push("challenger");
  if (isChallenge && ctx.challengeWon && (ctx.challengeWonCount ?? 0) >= 1)
    keys.push("challenge_winner");
  if (ctx.mode === "challenge_speed" && ctx.challengeWon && ctx.scorePct >= 80)
    keys.push("speed_master");
  if (isChallenge && (ctx.challengeWonCount ?? 0) >= 5) keys.push("top_challenger");
  return keys;
}

// ---------- Persistence ----------
/**
 * Awards XP + checks achievements after a quiz attempt.
 * Best-effort: failures are logged but don't block the user.
 */
export async function awardXpAndAchievements(params: {
  userId: string;
  attemptId: string | null;
  scorePct: number;
  mode: QuizMode;
  totalAttempts: number;
  highScoreCount: number;
  bestStreak: number;
  streakDayBonusEligible: boolean;
  challengeWon?: boolean;
  challengeCompletedCount?: number;
  challengeWonCount?: number;
}): Promise<{
  xpGained: number;
  awardedAchievements: string[];
  previousLevel: number;
  newLevel: number;
  newXp: number;
  leveledUp: boolean;
} | null> {
  try {
    const isPerfect = params.scorePct >= 100;
    const lines = computeXpAward({
      scorePct: params.scorePct,
      mode: params.mode,
      isPerfect,
      streakDayBonusEligible: params.streakDayBonusEligible,
      challengeWon: params.challengeWon,
    });
    const xpGained = lines.reduce((s, l) => s + l.amount, 0);

    // Insert XP events (one per line — easier to audit/aggregate)
    if (xpGained > 0) {
      const rows = lines.map((l) => ({
        user_id: params.userId,
        amount: l.amount,
        reason: l.reason,
        attempt_id: params.attemptId,
      }));
      const { error: xpErr } = await supabase.from("xp_events").insert(rows);
      if (xpErr) console.error("[gamification] xp_events insert failed", xpErr);
    }

    // Pull current XP, increment, recompute level, persist
    const { data: profile, error: pErr } = await supabase
      .from("profiles")
      .select("xp, level")
      .eq("id", params.userId)
      .maybeSingle();
    if (pErr) console.error("[gamification] profile read failed", pErr);

    const currentXp = profile?.xp ?? 0;
    const previousLevel = profile?.level ?? levelFromXp(currentXp).level;
    const newXp = currentXp + xpGained;
    const newLevel = levelFromXp(newXp).level;
    const todayIso = new Date().toISOString().slice(0, 10);

    const { error: updErr } = await supabase
      .from("profiles")
      .update({
        xp: newXp,
        level: newLevel,
        last_active_date: todayIso,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.userId);
    if (updErr) console.error("[gamification] profile update failed", updErr);

    // Achievements: insert any not-yet-earned keys
    const candidateKeys = achievementsToUnlock({
      totalAttempts: params.totalAttempts,
      highScoreCount: params.highScoreCount,
      bestStreak: params.bestStreak,
      scorePct: params.scorePct,
      isPerfect,
      mode: params.mode,
      challengeCompletedCount: params.challengeCompletedCount,
      challengeWonCount: params.challengeWonCount,
      challengeWon: params.challengeWon,
    });
    let awarded: string[] = [];
    if (candidateKeys.length > 0) {
      const { data: existing, error: exErr } = await supabase
        .from("user_achievements")
        .select("achievement_key")
        .eq("user_id", params.userId)
        .in("achievement_key", candidateKeys);
      if (exErr) console.error("[gamification] existing achievements read failed", exErr);
      const have = new Set((existing ?? []).map((r) => r.achievement_key as string));
      const toInsert = candidateKeys.filter((k) => !have.has(k));
      if (toInsert.length > 0) {
        const rows = toInsert.map((key) => ({
          user_id: params.userId,
          achievement_key: key,
        }));
        const { error: achErr } = await supabase.from("user_achievements").insert(rows);
        if (achErr) console.error("[gamification] achievements insert failed", achErr);
        else awarded = toInsert;
      }
    }

    return {
      xpGained,
      awardedAchievements: awarded,
      previousLevel,
      newLevel,
      newXp,
      leveledUp: newLevel > previousLevel,
    };
  } catch (err) {
    console.error("[gamification] award failed", err);
    return null;
  }
}

// ---------- Week boundaries (Mon 00:00 local) ----------
export function startOfWeek(date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7; // days since Monday
  d.setDate(d.getDate() - diff);
  return d;
}

export function endOfWeek(date = new Date()): Date {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end;
}

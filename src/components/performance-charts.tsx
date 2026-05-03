import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  Loader2,
  TrendingUp,
  BookOpen,
  Layers,
  Target,
  History,
  ThumbsUp,
  AlertTriangle,
} from "lucide-react";

interface AttemptRow {
  id: string;
  score: number;
  total: number;
  created_at: string;
  pdf_id: string;
  unit_id: string | null;
  difficulty: string;
  user_id: string;
}

interface UnitMeta {
  id: string;
  name: string;
  subject_id: string;
  subject_name: string;
}

interface EnrichedAttempt extends AttemptRow {
  pct: number;
  unit_name: string;
  subject_name: string;
}

export interface PerformanceChartsProps {
  /** When set, only this user's attempts are loaded. When omitted, all users are aggregated (admin view). */
  userId?: string;
  /** Title shown above the section. */
  title?: string;
  /** Compact mode — smaller heights for embedded use. */
  compact?: boolean;
}

const COLORS = [
  "var(--primary)",
  "var(--accent)",
  "oklch(0.70 0.18 230)",
  "oklch(0.75 0.17 160)",
  "oklch(0.80 0.16 75)",
  "oklch(0.72 0.20 320)",
];

const AXIS_COLOR = "oklch(0.85 0.02 275)";
const GRID_COLOR = "oklch(0.45 0.04 275 / 50%)";
const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--card-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--foreground)",
};
const TOOLTIP_LABEL_STYLE: React.CSSProperties = { color: "var(--foreground)", fontWeight: 600 };
const TOOLTIP_ITEM_STYLE: React.CSSProperties = { color: "var(--foreground)" };

export function PerformanceCharts({ userId, title = "Performance analytics", compact }: PerformanceChartsProps) {
  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState<EnrichedAttempt[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 1) Load attempts (filtered by user if applicable).
        let q = supabase
          .from("attempts")
          .select("id, score, total, created_at, pdf_id, unit_id, difficulty, user_id")
          .order("created_at", { ascending: true })
          .limit(1000);
        if (userId) q = q.eq("user_id", userId);
        const { data: rawAttempts, error: aErr } = await q;
        if (aErr) throw aErr;
        const rows = (rawAttempts ?? []) as AttemptRow[];

        // 2) Enrich with unit + subject names.
        const unitIds = Array.from(new Set(rows.map((r) => r.unit_id).filter(Boolean))) as string[];
        let unitMap = new Map<string, UnitMeta>();
        if (unitIds.length > 0) {
          const { data: units } = await supabase
            .from("units")
            .select("id, name, subject_id, subjects(name)")
            .in("id", unitIds);
          (units ?? []).forEach((u: any) => {
            unitMap.set(u.id, {
              id: u.id,
              name: u.name,
              subject_id: u.subject_id,
              subject_name: u.subjects?.name ?? "—",
            });
          });
        }

        const enriched: EnrichedAttempt[] = rows.map((r) => {
          const meta = r.unit_id ? unitMap.get(r.unit_id) : undefined;
          const pct = r.total > 0 ? Math.round((r.score / r.total) * 100) : 0;
          return {
            ...r,
            pct,
            unit_name: meta?.name ?? "Unknown",
            subject_name: meta?.subject_name ?? "Unknown",
          };
        });

        if (!cancelled) setAttempts(enriched);
      } catch (err) {
        console.error("[PerformanceCharts] load failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // === Aggregations ===
  const trend = useMemo(() => {
    // Group by day, average %.
    const byDay = new Map<string, { sum: number; count: number }>();
    attempts.forEach((a) => {
      const d = new Date(a.created_at).toISOString().slice(0, 10);
      const cur = byDay.get(d) ?? { sum: 0, count: 0 };
      cur.sum += a.pct;
      cur.count += 1;
      byDay.set(d, cur);
    });
    return Array.from(byDay.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-30)
      .map(([date, v]) => ({
        date: new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        avg: Math.round(v.sum / v.count),
        attempts: v.count,
      }));
  }, [attempts]);

  const subjects = useMemo(() => {
    const m = new Map<string, { sum: number; count: number }>();
    attempts.forEach((a) => {
      if (!a.subject_name || a.subject_name === "Unknown") return;
      const cur = m.get(a.subject_name) ?? { sum: 0, count: 0 };
      cur.sum += a.pct;
      cur.count += 1;
      m.set(a.subject_name, cur);
    });
    return Array.from(m.entries())
      .map(([name, v]) => ({ name, avg: Math.round(v.sum / v.count), attempts: v.count }))
      .sort((a, b) => b.avg - a.avg);
  }, [attempts]);

  const units = useMemo(() => {
    const m = new Map<string, { sum: number; count: number }>();
    attempts.forEach((a) => {
      if (!a.unit_name || a.unit_name === "Unknown") return;
      const cur = m.get(a.unit_name) ?? { sum: 0, count: 0 };
      cur.sum += a.pct;
      cur.count += 1;
      m.set(a.unit_name, cur);
    });
    return Array.from(m.entries())
      .map(([name, v]) => ({ name, avg: Math.round(v.sum / v.count), attempts: v.count }))
      .sort((a, b) => b.avg - a.avg);
  }, [attempts]);

  const accuracy = useMemo(() => {
    if (attempts.length === 0) return { pct: 0, correct: 0, total: 0 };
    const correct = attempts.reduce((s, a) => s + a.score, 0);
    const total = attempts.reduce((s, a) => s + a.total, 0);
    return { pct: total > 0 ? Math.round((correct / total) * 100) : 0, correct, total };
  }, [attempts]);

  const strong = subjects.filter((s) => s.avg >= 75).slice(0, 5);
  const weak = subjects.filter((s) => s.avg < 60).slice(0, 5);

  if (loading) {
    return (
      <div className="rounded-3xl bg-gradient-card border border-border/60 p-10 shadow-card flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary-glow" />
      </div>
    );
  }

  if (attempts.length === 0) {
    return (
      <div className="rounded-3xl bg-gradient-card border border-border/60 p-10 shadow-card text-center">
        <TrendingUp className="mx-auto h-8 w-8 text-muted-foreground/60" />
        <p className="mt-3 text-sm text-muted-foreground">No performance data available yet.</p>
      </div>
    );
  }

  const chartH = compact ? 200 : 240;
  const donutData = [
    { name: "Correct", value: accuracy.correct },
    { name: "Wrong", value: Math.max(0, accuracy.total - accuracy.correct) },
  ];

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary-glow">
          <TrendingUp className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">
            {attempts.length} quiz{attempts.length === 1 ? "" : "zes"} analysed
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Score trend */}
        <Card className="lg:col-span-2 p-5 bg-gradient-card border-border/60">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-primary-glow" />
            <h3 className="font-semibold text-sm">Score trend (last 30 days)</h3>
          </div>
          <ResponsiveContainer width="100%" height={chartH}>
            <LineChart data={trend} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} opacity={0.3} />
              <XAxis dataKey="date" stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR }} fontSize={11} />
              <YAxis domain={[0, 100]} stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR }} fontSize={11} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                cursor={{ fill: "var(--muted)", opacity: 0.2 }}
              />
              <Line
                type="monotone"
                dataKey="avg"
                stroke="var(--primary)"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "var(--primary)" }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Accuracy donut */}
        <Card className="p-5 bg-gradient-card border-border/60">
          <div className="flex items-center gap-2 mb-3">
            <Target className="h-4 w-4 text-primary-glow" />
            <h3 className="font-semibold text-sm">Overall accuracy</h3>
          </div>
          <div className="relative">
            <ResponsiveContainer width="100%" height={chartH}>
              <PieChart>
                <Pie
                  data={donutData}
                  innerRadius={compact ? 50 : 60}
                  outerRadius={compact ? 75 : 85}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  <Cell fill="var(--primary)" />
                  <Cell fill="var(--muted)" />
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} cursor={{ fill: "var(--muted)", opacity: 0.2 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <div className="text-3xl font-bold">{accuracy.pct}%</div>
              <div className="text-xs text-muted-foreground">
                {accuracy.correct}/{accuracy.total} correct
              </div>
            </div>
          </div>
        </Card>

        {/* Subject-wise */}
        <Card className="lg:col-span-2 p-5 bg-gradient-card border-border/60">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen className="h-4 w-4 text-primary-glow" />
            <h3 className="font-semibold text-sm">Subject-wise average score</h3>
          </div>
          {subjects.length === 0 ? (
            <p className="text-xs text-muted-foreground">No subject data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={chartH}>
              <BarChart data={subjects.slice(0, 8)} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} opacity={0.3} />
                <XAxis dataKey="name" stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR }} fontSize={11} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis domain={[0, 100]} stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR }} fontSize={11} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} cursor={{ fill: "var(--muted)", opacity: 0.2 }} />
                <Bar dataKey="avg" radius={[6, 6, 0, 0]}>
                  {subjects.slice(0, 8).map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Strong / weak topics */}
        <Card className="p-5 bg-gradient-card border-border/60">
          <div className="flex items-center gap-2 mb-3">
            <ThumbsUp className="h-4 w-4 text-success" />
            <h3 className="font-semibold text-sm">Strong vs weak topics</h3>
          </div>
          <div className="space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
                <ThumbsUp className="h-3 w-3 text-success" /> Strong
              </div>
              {strong.length === 0 ? (
                <p className="text-xs text-muted-foreground">No strong topics yet.</p>
              ) : (
                <ul className="space-y-1">
                  {strong.map((s) => (
                    <li key={s.name} className="flex justify-between text-xs">
                      <span className="truncate pr-2">{s.name}</span>
                      <span className="font-semibold text-success shrink-0">{s.avg}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-destructive" /> Weak
              </div>
              {weak.length === 0 ? (
                <p className="text-xs text-muted-foreground">No weak areas — great work!</p>
              ) : (
                <ul className="space-y-1">
                  {weak.map((s) => (
                    <li key={s.name} className="flex justify-between text-xs">
                      <span className="truncate pr-2">{s.name}</span>
                      <span className="font-semibold text-destructive shrink-0">{s.avg}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>

        {/* Unit-wise */}
        <Card className="lg:col-span-3 p-5 bg-gradient-card border-border/60">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="h-4 w-4 text-primary-glow" />
            <h3 className="font-semibold text-sm">Unit-wise performance</h3>
          </div>
          {units.length === 0 ? (
            <p className="text-xs text-muted-foreground">No unit data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={chartH}>
              <BarChart data={units.slice(0, 12)} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} opacity={0.3} />
                <XAxis dataKey="name" stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR }} fontSize={11} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis domain={[0, 100]} stroke={AXIS_COLOR} tick={{ fill: AXIS_COLOR }} fontSize={11} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} cursor={{ fill: "var(--muted)", opacity: 0.2 }} />
                <Bar dataKey="avg" fill="var(--accent)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Quiz attempts history */}
        <Card className="lg:col-span-3 p-5 bg-gradient-card border-border/60">
          <div className="flex items-center gap-2 mb-3">
            <History className="h-4 w-4 text-primary-glow" />
            <h3 className="font-semibold text-sm">Recent attempts</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr className="border-b border-border/40">
                  <th className="text-left py-2 font-medium">When</th>
                  <th className="text-left py-2 font-medium">Subject</th>
                  <th className="text-left py-2 font-medium">Unit</th>
                  <th className="text-left py-2 font-medium">Difficulty</th>
                  <th className="text-right py-2 font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {[...attempts]
                  .reverse()
                  .slice(0, 10)
                  .map((a) => (
                    <tr key={a.id} className="border-b border-border/20 last:border-0">
                      <td className="py-2 text-xs">{new Date(a.created_at).toLocaleDateString()}</td>
                      <td className="py-2 text-xs">{a.subject_name}</td>
                      <td className="py-2 text-xs">{a.unit_name}</td>
                      <td className="py-2 text-xs capitalize">{a.difficulty}</td>
                      <td className="py-2 text-xs text-right font-semibold">
                        <span
                          className={
                            a.pct >= 80
                              ? "text-success"
                              : a.pct >= 60
                                ? "text-warning"
                                : "text-destructive"
                          }
                        >
                          {a.score}/{a.total} ({a.pct}%)
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </section>
  );
}

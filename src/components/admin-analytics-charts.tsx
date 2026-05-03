import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PerformanceCharts } from "./performance-charts";
import { Loader2, Search, Trophy, TrendingDown, X, UserRound } from "lucide-react";

interface StudentAgg {
  user_id: string;
  full_name: string | null;
  avg: number;
  attempts: number;
}

export function AdminAnalyticsCharts() {
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<StudentAgg[]>([]);
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: rows } = await supabase
          .from("attempts")
          .select("user_id, score, total")
          .limit(1000);
        const list = (rows ?? []) as { user_id: string; score: number; total: number }[];
        const byUser = new Map<string, { sum: number; count: number }>();
        list.forEach((r) => {
          const cur = byUser.get(r.user_id) ?? { sum: 0, count: 0 };
          cur.sum += r.total > 0 ? (r.score / r.total) * 100 : 0;
          cur.count += 1;
          byUser.set(r.user_id, cur);
        });
        const userIds = Array.from(byUser.keys());
        let nameMap = new Map<string, string | null>();
        if (userIds.length > 0) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", userIds);
          (profs ?? []).forEach((p: any) => nameMap.set(p.id, p.full_name));
        }
        const aggs: StudentAgg[] = Array.from(byUser.entries()).map(([uid, v]) => ({
          user_id: uid,
          full_name: nameMap.get(uid) ?? null,
          avg: Math.round(v.sum / v.count),
          attempts: v.count,
        }));
        setStudents(aggs);
      } catch (err) {
        console.error("[AdminAnalytics] failed", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const top = useMemo(() => [...students].sort((a, b) => b.avg - a.avg).slice(0, 5), [students]);
  const low = useMemo(
    () => [...students].filter((s) => s.attempts >= 1).sort((a, b) => a.avg - b.avg).slice(0, 5),
    [students],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students.slice(0, 8);
    return students
      .filter((s) => (s.full_name ?? "").toLowerCase().includes(q) || s.user_id.includes(q))
      .slice(0, 12);
  }, [students, search]);

  if (loading) {
    return (
      <div className="rounded-3xl bg-gradient-card border border-border/60 p-10 shadow-card flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary-glow" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overall charts (all students aggregated) */}
      <PerformanceCharts title="Overall student performance" />

      {/* Top / Low performers */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5 bg-gradient-card border-border/60">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="h-4 w-4 text-warning" />
            <h3 className="font-semibold text-sm">Top performing students</h3>
          </div>
          {top.length === 0 ? (
            <p className="text-xs text-muted-foreground">No student data yet.</p>
          ) : (
            <ul className="space-y-2">
              {top.map((s, i) => (
                <li
                  key={s.user_id}
                  className="flex items-center justify-between rounded-lg border border-border/40 bg-surface/30 px-3 py-2 hover:bg-surface/50 transition-colors cursor-pointer"
                  onClick={() => setSelectedUser({ id: s.user_id, name: s.full_name ?? "Student" })}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="text-xs font-bold text-primary-glow w-5">#{i + 1}</span>
                    <span className="text-sm truncate">{s.full_name ?? "Unnamed student"}</span>
                  </span>
                  <span className="text-sm font-semibold text-success shrink-0">{s.avg}%</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5 bg-gradient-card border-border/60">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="h-4 w-4 text-destructive" />
            <h3 className="font-semibold text-sm">Students needing support</h3>
          </div>
          {low.length === 0 ? (
            <p className="text-xs text-muted-foreground">No student data yet.</p>
          ) : (
            <ul className="space-y-2">
              {low.map((s, i) => (
                <li
                  key={s.user_id}
                  className="flex items-center justify-between rounded-lg border border-border/40 bg-surface/30 px-3 py-2 hover:bg-surface/50 transition-colors cursor-pointer"
                  onClick={() => setSelectedUser({ id: s.user_id, name: s.full_name ?? "Student" })}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="text-xs font-bold text-muted-foreground w-5">#{i + 1}</span>
                    <span className="text-sm truncate">{s.full_name ?? "Unnamed student"}</span>
                  </span>
                  <span className="text-sm font-semibold text-destructive shrink-0">{s.avg}%</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Per-student deep dive */}
      <Card className="p-5 bg-gradient-card border-border/60">
        <div className="flex items-center gap-2 mb-3">
          <UserRound className="h-4 w-4 text-primary-glow" />
          <h3 className="font-semibold text-sm">Inspect a particular student</h3>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search students by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground">No matching students.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {filtered.map((s) => (
              <Button
                key={s.user_id}
                size="sm"
                variant={selectedUser?.id === s.user_id ? "default" : "outline"}
                onClick={() => setSelectedUser({ id: s.user_id, name: s.full_name ?? "Student" })}
              >
                {s.full_name ?? s.user_id.slice(0, 8)} · {s.avg}%
              </Button>
            ))}
          </div>
        )}

        {selectedUser && (
          <div className="mt-5 pt-5 border-t border-border/40">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Viewing</div>
                <div className="text-base font-semibold">{selectedUser.name}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSelectedUser(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <PerformanceCharts userId={selectedUser.id} title={`${selectedUser.name}'s analytics`} compact />
          </div>
        )}
      </Card>
    </div>
  );
}

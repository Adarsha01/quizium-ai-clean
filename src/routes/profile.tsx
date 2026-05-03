import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Navbar } from "@/components/navbar";
import { ProtectedRoute } from "@/components/protected-route";
import { BackButton } from "@/components/back-button";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Upload,
  UserRound,
  Mail,
  Phone,
  CalendarDays,
  GraduationCap,
  BookOpen,
  MapPin,
  ShieldCheck,
  Save,
  Sparkles,
  Trophy,
  Flame,
  Zap,
  Medal,
  Star,
  Crosshair,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { levelFromXp, startOfWeek, endOfWeek } from "@/lib/gamification";
import { cn } from "@/lib/utils";
import { PerformanceCharts } from "@/components/performance-charts";

export const Route = createFileRoute("/profile")({
  component: () => (
    <ProtectedRoute>
      <ProfilePage />
    </ProtectedRoute>
  ),
});

interface ProfileForm {
  full_name: string;
  phone: string;
  gender: string;
  date_of_birth: string; // yyyy-mm-dd
  course: string;
  semester: string;
  address: string;
  bio: string;
}

const EMPTY_FORM: ProfileForm = {
  full_name: "",
  phone: "",
  gender: "",
  date_of_birth: "",
  course: "",
  semester: "",
  address: "",
  bio: "",
};

interface AchievementCatalog {
  key: string;
  name: string;
  description: string;
  icon: string;
  xp_reward: number;
  sort_order: number;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  sparkles: Sparkles,
  flame: Flame,
  trophy: Trophy,
  medal: Medal,
  zap: Zap,
  crosshair: Crosshair,
  star: Star,
};

function ProfilePage() {
  const { user, role } = useAuth();
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [xp, setXp] = useState<number>(0);
  const [achievementsCatalog, setAchievementsCatalog] = useState<AchievementCatalog[]>([]);
  const [earnedKeys, setEarnedKeys] = useState<Set<string>>(new Set());
  const [weeklyRank, setWeeklyRank] = useState<number | null>(null);

  const isAdmin = role === "admin";

  useEffect(() => {
    (async () => {
      const [profileRes, catalogRes, earnedRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle(),
        supabase
          .from("achievements")
          .select("key, name, description, icon, xp_reward, sort_order")
          .order("sort_order"),
        supabase
          .from("user_achievements")
          .select("achievement_key")
          .eq("user_id", user!.id),
      ]);
      if (profileRes.error) toast.error(profileRes.error.message);
      const data = profileRes.data;
      if (data) {
        setForm({
          full_name: data.full_name ?? "",
          phone: (data as any).phone ?? "",
          gender: (data as any).gender ?? "",
          date_of_birth: (data as any).date_of_birth ?? "",
          course: (data as any).course ?? "",
          semester: (data as any).semester ?? "",
          address: (data as any).address ?? "",
          bio: (data as any).bio ?? "",
        });
        setAvatarUrl(data.avatar_url);
        setXp((data as any).xp ?? 0);
      }
      setAchievementsCatalog((catalogRes.data ?? []) as AchievementCatalog[]);
      setEarnedKeys(
        new Set((earnedRes.data ?? []).map((r: any) => r.achievement_key as string)),
      );

      // Compute weekly rank (best-effort)
      if (!isAdmin) {
        try {
          const wkStart = startOfWeek().toISOString();
          const wkEnd = endOfWeek().toISOString();
          const { data: rows } = await supabase
            .from("attempts")
            .select("user_id, score, total")
            .gte("created_at", wkStart)
            .lt("created_at", wkEnd);
          const list = (rows ?? []) as { user_id: string; score: number; total: number }[];
          if (list.length > 0) {
            const byUser = new Map<string, { sum: number; count: number }>();
            list.forEach((r) => {
              const cur = byUser.get(r.user_id) ?? { sum: 0, count: 0 };
              cur.sum += (r.score / r.total) * 100;
              cur.count += 1;
              byUser.set(r.user_id, cur);
            });
            const ranked = Array.from(byUser.entries())
              .map(([uid, v]) => ({ uid, avg: v.sum / v.count }))
              .sort((a, b) => b.avg - a.avg);
            const idx = ranked.findIndex((r) => r.uid === user!.id);
            setWeeklyRank(idx >= 0 ? idx + 1 : null);
          }
        } catch (err) {
          console.error("[Profile] rank load failed", err);
        }
      }

      setLoading(false);
    })();
  }, [user, isAdmin]);

  const update = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: form.full_name || null,
        phone: form.phone || null,
        gender: form.gender || null,
        date_of_birth: form.date_of_birth || null,
        course: form.course || null,
        semester: form.semester || null,
        address: form.address || null,
        bio: form.bio || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user!.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Profile updated successfully");
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please pick an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be 5MB or smaller");
      return;
    }
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${user!.id}/avatar-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });
    if (upErr) {
      toast.error(upErr.message);
      setUploading(false);
      return;
    }
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = pub.publicUrl;
    setAvatarUrl(url);
    await supabase
      .from("profiles")
      .update({ avatar_url: url, updated_at: new Date().toISOString() })
      .eq("id", user!.id);
    setUploading(false);
    toast.success("Profile picture updated");
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="flex justify-center pt-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary-glow" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <BackButton className="mb-3 -ml-2" />

        {/* Header card */}
        <div className="rounded-3xl bg-gradient-card border border-border/60 p-6 sm:p-8 shadow-elevated">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <div className="relative h-24 w-24 rounded-2xl overflow-hidden bg-surface flex items-center justify-center border border-border/60 shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Profile picture" className="h-full w-full object-cover" />
              ) : (
                <UserRound className="h-10 w-10 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-bold truncate">
                  {form.full_name || "Your profile"}
                </h1>
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary-glow capitalize"
                  title="Account role"
                >
                  {isAdmin ? <ShieldCheck className="h-3 w-3" /> : <GraduationCap className="h-3 w-3" />}
                  {role ?? "user"}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> {user!.email}
              </p>
              <div className="mt-4">
                <Label htmlFor="avatar" className="cursor-pointer">
                  <span className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-surface/40 px-3 py-1.5 text-sm hover:bg-accent/20 transition-colors">
                    {uploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    {uploading ? "Uploading…" : "Change profile picture"}
                  </span>
                  <input
                    id="avatar"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onUpload}
                  />
                </Label>
                <p className="mt-1.5 text-xs text-muted-foreground">PNG or JPG, up to 5MB</p>
              </div>
            </div>
          </div>
        </div>

        {/* Gamification panel — students only */}
        {!isAdmin && (
          <section className="mt-6 rounded-3xl bg-gradient-card border border-border/60 p-6 sm:p-8 shadow-card">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary-glow">
                <Trophy className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-lg font-semibold">Your progress</h2>
                <p className="text-xs text-muted-foreground">
                  XP, level, weekly rank, and achievements.
                </p>
              </div>
            </div>

            {(() => {
              const info = levelFromXp(xp);
              return (
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-border/40 bg-surface/30 p-4 sm:col-span-2">
                    <div className="flex items-center gap-3">
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
                        <div className="font-semibold">{xp} Total XP</div>
                      </div>
                    </div>
                    <div className="mt-3">
                      <Progress value={info.progressPct} className="h-2" />
                      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{info.xpIntoLevel} XP into level</span>
                        <span>
                          {info.isMax
                            ? "Max level reached!"
                            : `${info.xpForNextLevel - info.xpIntoLevel} XP to L${info.level + 1}`}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/40 bg-surface/30 p-4 flex flex-col items-start justify-between">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                      Weekly rank
                    </div>
                    <div className="mt-1 text-2xl font-bold">
                      {weeklyRank ? `#${weeklyRank}` : "—"}
                    </div>
                    <Link
                      to="/leaderboard"
                      className="mt-2 text-xs text-primary-glow hover:underline inline-flex items-center gap-1"
                    >
                      <Trophy className="h-3 w-3" /> View leaderboard
                    </Link>
                  </div>
                </div>
              );
            })()}

            {/* Achievements */}
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Achievements
                </h3>
                <span className="text-xs text-muted-foreground">
                  {earnedKeys.size} / {achievementsCatalog.length} unlocked
                </span>
              </div>
              {achievementsCatalog.length === 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Achievements will appear here.
                </p>
              ) : (
                <div className="mt-3 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                  {achievementsCatalog.map((a) => {
                    const earned = earnedKeys.has(a.key);
                    const Icon = ICON_MAP[a.icon] ?? Star;
                    return (
                      <div
                        key={a.key}
                        className={cn(
                          "rounded-xl border p-3 text-center transition-all",
                          earned
                            ? "border-primary/40 bg-primary/5 shadow-card"
                            : "border-border/40 bg-surface/20 opacity-70",
                        )}
                        title={a.description}
                      >
                        <div
                          className={cn(
                            "mx-auto flex h-10 w-10 items-center justify-center rounded-full",
                            earned ? "bg-primary/15" : "bg-muted/30",
                          )}
                        >
                          {earned ? (
                            <Icon className="h-5 w-5 text-primary-glow" />
                          ) : (
                            <Lock className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="mt-2 text-xs font-semibold truncate">
                          {a.name}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                          {a.description}
                        </div>
                        {a.xp_reward > 0 && (
                          <div
                            className={cn(
                              "mt-1.5 inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                              earned
                                ? "bg-primary/15 text-primary-glow border border-primary/30"
                                : "bg-surface/40 text-muted-foreground border border-border/40",
                            )}
                          >
                            <Zap className="h-2.5 w-2.5" /> {a.xp_reward} XP
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Student performance analytics */}
        {!isAdmin && (
          <div className="mt-6">
            <PerformanceCharts userId={user!.id} title="Performance analytics" />
          </div>
        )}

        <form onSubmit={save} className="mt-6 space-y-6">
          {/* Personal */}
          <Section
            icon={<UserRound className="h-4 w-4" />}
            title="Personal information"
            subtitle="How we identify you across Quizium."
          >
            <Field label="Full name" htmlFor="full_name">
              <Input
                id="full_name"
                value={form.full_name}
                onChange={(e) => update("full_name", e.target.value)}
                placeholder="Your full name"
              />
            </Field>
            <Field label="Email address" htmlFor="email" hint="Linked to your account — can't be changed here.">
              <Input id="email" value={user!.email ?? ""} disabled className="opacity-70" />
            </Field>
            <Field label="Phone number" htmlFor="phone">
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  placeholder="+1 555 123 4567"
                  className="pl-9"
                  inputMode="tel"
                />
              </div>
            </Field>
            <Field label="Gender" htmlFor="gender">
              <Select value={form.gender} onValueChange={(v) => update("gender", v)}>
                <SelectTrigger id="gender">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="non-binary">Non-binary</SelectItem>
                  <SelectItem value="prefer-not-to-say">Prefer not to say</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Date of birth" htmlFor="dob">
              <div className="relative">
                <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="dob"
                  type="date"
                  value={form.date_of_birth}
                  onChange={(e) => update("date_of_birth", e.target.value)}
                  className="pl-9"
                />
              </div>
            </Field>
            <Field label="Role" htmlFor="role" hint="Set by an administrator.">
              <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm opacity-80">
                {isAdmin ? (
                  <ShieldCheck className="h-4 w-4 text-primary-glow" />
                ) : (
                  <GraduationCap className="h-4 w-4 text-primary-glow" />
                )}
                <span className="capitalize">{role ?? "user"}</span>
              </div>
            </Field>
          </Section>

          {/* Academic */}
          <Section
            icon={<BookOpen className="h-4 w-4" />}
            title={isAdmin ? "Department" : "Academic details"}
            subtitle={
              isAdmin
                ? "Where you manage content from."
                : "Helps us personalise your learning."
            }
          >
            <Field label={isAdmin ? "Department" : "Course / Department"} htmlFor="course">
              <Input
                id="course"
                value={form.course}
                onChange={(e) => update("course", e.target.value)}
                placeholder={isAdmin ? "e.g. Computer Science" : "e.g. B.Sc. Computer Science"}
              />
            </Field>
            {!isAdmin && (
              <Field label="Semester" htmlFor="semester">
                <Input
                  id="semester"
                  value={form.semester}
                  onChange={(e) => update("semester", e.target.value)}
                  placeholder="e.g. Semester 4"
                />
              </Field>
            )}
          </Section>

          {/* Address & Bio */}
          <Section
            icon={<Sparkles className="h-4 w-4" />}
            title="About you"
            subtitle="Optional — share a little more."
          >
            <Field label="Address" htmlFor="address" full>
              <div className="relative">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Textarea
                  id="address"
                  value={form.address}
                  onChange={(e) => update("address", e.target.value)}
                  placeholder="Street, city, country"
                  rows={2}
                  className="pl-9 resize-none"
                />
              </div>
            </Field>
            <Field label="Bio / About" htmlFor="bio" full>
              <Textarea
                id="bio"
                value={form.bio}
                onChange={(e) => update("bio", e.target.value)}
                placeholder="Tell us a bit about yourself…"
                rows={3}
                className="resize-none"
              />
            </Field>
          </Section>

          <div className="flex justify-end">
            <Button type="submit" variant="hero" size="lg" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save changes
                </>
              )}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl bg-gradient-card border border-border/60 p-6 sm:p-8 shadow-card">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary-glow">
          {icon}
        </span>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  full,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "sm:col-span-2 space-y-1.5" : "space-y-1.5"}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

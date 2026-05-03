-- =========================================================
-- Gamification: XP, levels, achievements, leaderboard
-- =========================================================

-- 1. Extend profiles with XP / level / activity tracking
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_active_date DATE;

-- 2. Allow all authenticated users to view basic profile info for leaderboards.
-- (Existing policy only let owners + admins view profiles, which broke
-- leaderboard avatars/names.)
CREATE POLICY "profiles public read for leaderboard"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- 3. Achievements catalog (master list, seeded below)
CREATE TABLE IF NOT EXISTS public.achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'star',
  xp_reward INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "achievements readable by all authenticated"
ON public.achievements
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "admin manage achievements"
ON public.achievements
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 4. User achievements (which user unlocked what, when)
CREATE TABLE IF NOT EXISTS public.user_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  achievement_key TEXT NOT NULL REFERENCES public.achievements(key) ON DELETE CASCADE,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, achievement_key)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON public.user_achievements(user_id);

ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users view own + admin view all achievements"
ON public.user_achievements
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "users insert own achievements"
ON public.user_achievements
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- 5. XP event log (one row per XP grant) — used for weekly leaderboards
CREATE TABLE IF NOT EXISTS public.xp_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  attempt_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xp_events_user_created ON public.xp_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_xp_events_created ON public.xp_events(created_at DESC);

ALTER TABLE public.xp_events ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read XP events (so the leaderboard can sum
-- weekly XP across the cohort). No PII is exposed — only user_id + amount.
CREATE POLICY "xp events readable by authenticated"
ON public.xp_events
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "users insert own xp events"
ON public.xp_events
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- 6. Optional historical leaderboard snapshots (kept for future cron)
CREATE TABLE IF NOT EXISTS public.leaderboard_weekly (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('score', 'streak', 'improvement', 'xp')),
  rank INTEGER NOT NULL,
  user_id UUID NOT NULL,
  value NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (week_start, kind, user_id)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_week_kind
  ON public.leaderboard_weekly(week_start, kind, rank);

ALTER TABLE public.leaderboard_weekly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leaderboard readable by authenticated"
ON public.leaderboard_weekly
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "admin manage leaderboard"
ON public.leaderboard_weekly
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 7. Seed the achievements catalog
INSERT INTO public.achievements (key, name, description, icon, xp_reward, sort_order) VALUES
  ('quiz_beginner',     'Quiz Beginner',     'Complete your first quiz',                'sparkles', 10, 10),
  ('consistent_learner','Consistent Learner','Maintain a 5-day daily streak',           'flame',    25, 20),
  ('high_scorer',       'High Scorer',       'Score 80% or higher on a quiz',           'trophy',   20, 30),
  ('concept_master',    'Concept Master',    'Score 80%+ on five different quizzes',    'medal',    50, 40),
  ('streak_king',       'Streak King',       'Reach a 10-day daily streak',             'zap',      75, 50),
  ('focus_fighter',     'Focus Fighter',     'Complete a Focus Mode quiz',              'crosshair',15, 60),
  ('perfectionist',     'Perfectionist',     'Score 100% on any quiz',                  'star',     30, 70)
ON CONFLICT (key) DO NOTHING;

-- 1) Expand attempts.mode to include challenge modes
ALTER TABLE public.attempts DROP CONSTRAINT IF EXISTS attempts_mode_check;
ALTER TABLE public.attempts ADD CONSTRAINT attempts_mode_check
  CHECK (mode = ANY (ARRAY['standard'::text, 'focus'::text, 'daily'::text, 'challenge_std'::text, 'challenge_speed'::text]));

-- 2) Seed challenge achievements (idempotent)
INSERT INTO public.achievements (key, name, description, icon, xp_reward, sort_order)
VALUES
  ('challenger', 'Challenger', 'Complete your first challenge', 'swords', 20, 200),
  ('challenge_winner', 'Challenge Winner', 'Win your first challenge', 'trophy', 30, 201),
  ('speed_master', 'Speed Master', 'Win a speed challenge with 80%+', 'zap', 40, 202),
  ('top_challenger', 'Top Challenger', 'Win 5 challenges', 'crown', 60, 203)
ON CONFLICT (key) DO NOTHING;

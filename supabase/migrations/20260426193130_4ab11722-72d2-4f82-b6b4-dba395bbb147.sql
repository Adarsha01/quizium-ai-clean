ALTER TABLE public.attempts
  DROP CONSTRAINT IF EXISTS attempts_mode_check;

ALTER TABLE public.attempts
  ADD CONSTRAINT attempts_mode_check CHECK (mode IN ('standard', 'focus', 'daily'));
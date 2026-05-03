-- Track quiz mode so Focus Mode attempts can be analyzed separately.
-- Existing rows default to 'standard'.
ALTER TABLE public.attempts
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'standard';

ALTER TABLE public.attempts
  DROP CONSTRAINT IF EXISTS attempts_mode_check;
ALTER TABLE public.attempts
  ADD CONSTRAINT attempts_mode_check CHECK (mode IN ('standard', 'focus'));

CREATE INDEX IF NOT EXISTS attempts_user_mode_idx
  ON public.attempts (user_id, mode, created_at DESC);


ALTER TABLE public.quiz_questions
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS tip text,
  ADD COLUMN IF NOT EXISTS page_reference text;

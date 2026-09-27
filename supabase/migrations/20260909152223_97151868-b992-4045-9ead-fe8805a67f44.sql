ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES public.files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trashed_at timestamptz;

CREATE INDEX IF NOT EXISTS files_user_hash_idx ON public.files (user_id, content_hash);
CREATE INDEX IF NOT EXISTS files_trashed_at_idx ON public.files (trashed_at);
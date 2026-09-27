CREATE TABLE public.folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL DEFAULT 'slate',
  created_by_ai BOOLEAN NOT NULL DEFAULT false,
  parent_id UUID REFERENCES public.folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX folders_user_name_idx ON public.folders (user_id, lower(name));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folders TO authenticated;
GRANT ALL ON public.folders TO service_role;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own folders" ON public.folders FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size BIGINT NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  summary TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  starred BOOLEAN NOT NULL DEFAULT false,
  trashed BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'upload',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX files_user_folder_idx ON public.files (user_id, folder_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.files TO authenticated;
GRANT ALL ON public.files TO service_role;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own files" ON public.files FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.sort_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  file_id UUID REFERENCES public.files(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL,
  folder_name TEXT NOT NULL,
  previous_folder_id UUID,
  reason TEXT,
  confidence NUMERIC,
  created_folder BOOLEAN NOT NULL DEFAULT false,
  undone BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sort_events TO authenticated;
GRANT ALL ON public.sort_events TO service_role;
ALTER TABLE public.sort_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sort events" ON public.sort_events FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER folders_touch BEFORE UPDATE ON public.folders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER files_touch BEFORE UPDATE ON public.files FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE POLICY "vault read own" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'vault' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "vault insert own" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'vault' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "vault update own" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'vault' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "vault delete own" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'vault' AND auth.uid()::text = (storage.foldername(name))[1]);
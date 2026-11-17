CREATE TABLE public.brushings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  local_date date NOT NULL,
  slot text NOT NULL CHECK (slot IN ('am','pm')),
  photo_path text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  confidence real,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, local_date, slot)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brushings TO authenticated;
GRANT ALL ON public.brushings TO service_role;
ALTER TABLE public.brushings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select" ON public.brushings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own insert" ON public.brushings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update" ON public.brushings FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own delete" ON public.brushings FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "selfies own read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='selfies' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "selfies own insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='selfies' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "selfies own update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id='selfies' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "selfies own delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id='selfies' AND (storage.foldername(name))[1] = auth.uid()::text);
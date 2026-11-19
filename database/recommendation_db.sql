-- Base del servicio Recommendation. Crear antes la base: CREATE DATABASE recommendation_db;
-- Ejecutar conectado a recommendation_db.
-- absence_id, flight_id y crew_user_id son ids de otras bases; no hay llaves foráneas.

-- Candidatos propuestos para cubrir una ausencia, en orden.
-- status: proposed (en la lista) · offered (se le ofreció) · missed (dejó vencer
-- el plazo) · accepted (dio «Enterado») · discarded (reemplazado por otra ronda).
CREATE TABLE IF NOT EXISTS public.replacement_suggestions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  absence_id    UUID        NOT NULL,
  crew_user_id  UUID        NOT NULL,
  rank_position SMALLINT    NOT NULL CHECK (rank_position > 0),
  affinity      SMALLINT    NOT NULL CHECK (affinity BETWEEN 0 AND 100),
  checks        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  rationale     TEXT        NOT NULL,
  source        TEXT        NOT NULL CHECK (source IN ('ai', 'rule')),
  status        TEXT        NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'offered', 'missed', 'accepted', 'discarded')),
  round         SMALLINT    NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (absence_id, round, crew_user_id)
);

CREATE INDEX IF NOT EXISTS replacement_suggestions_absence_idx
  ON public.replacement_suggestions (absence_id, round, rank_position);

-- supervisor_reason: motivo con el que el supervisor pidió esta ronda (opcional).
ALTER TABLE public.replacement_suggestions ADD COLUMN IF NOT EXISTS supervisor_reason TEXT;

-- Auditoría de cada decisión de la IA: qué se envió, qué respondió y si se usó
-- el plan B (orden por reglas). Sirve para explicar después una elección.
CREATE TABLE IF NOT EXISTS public.ai_calls (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT        NOT NULL CHECK (kind IN ('replacement', 'schedule')),
  subject_id    UUID        NOT NULL,
  model         TEXT,
  request       JSONB       NOT NULL,
  response      JSONB,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  duration_ms   INTEGER,
  used_fallback BOOLEAN     NOT NULL DEFAULT false,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_calls_subject_idx
  ON public.ai_calls (kind, subject_id, created_at);

-- Base del servicio Crew. Crear antes la base: CREATE DATABASE crew_db;
-- Ejecutar conectado a crew_db.
-- user_id es el id del usuario en admin_db; no hay llave foránea porque cada servicio tiene su propia base.

CREATE TABLE IF NOT EXISTS public.crew_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL UNIQUE,
  employee_code    VARCHAR(30) UNIQUE,
  position         VARCHAR(40) NOT NULL,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  current_location TEXT,
  status           TEXT        NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'on_duty', 'in_flight', 'medical_leave'))
);

-- Ausencias reportadas por los tripulantes. flight_id es el vuelo en flights_db;
-- se guarda una copia del número y la hora para mostrar la lista sin consultar Flights.
CREATE TABLE IF NOT EXISTS public.absences (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_user_id        UUID        NOT NULL,
  flight_id           UUID        NOT NULL,
  flight_number       TEXT        NOT NULL,
  flight_departure_at TIMESTAMPTZ NOT NULL,
  reason              TEXT        NOT NULL
    CHECK (reason IN ('illness', 'fatigue', 'emergency', 'transfer')),
  notes               TEXT,
  status              TEXT        NOT NULL DEFAULT 'reported'
    CHECK (status IN ('reported', 'covered')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (crew_user_id, flight_id)
);

-- Quién cubrió la ausencia y cuándo. ALTER para bases creadas antes de estas columnas.
ALTER TABLE public.absences ADD COLUMN IF NOT EXISTS replacement_user_id UUID;
ALTER TABLE public.absences ADD COLUMN IF NOT EXISTS covered_at TIMESTAMPTZ;

-- ===== Supervisor, programación y recomendaciones =====

-- Datos que usan las reglas de elegibilidad y la pantalla de Tripulación.
-- rank: cargo a bordo · ratings: familias de avión habilitadas (A320, 787...)
-- english_level: nivel OACI (1 a 6) · status on_duty = de guardia en el aeropuerto.
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS rank TEXT
  CHECK (rank IN ('captain', 'first_officer', 'purser', 'flight_attendant'));
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS base_code TEXT;
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS ratings TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS english_level SMALLINT
  CHECK (english_level BETWEEN 1 AND 6);
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS medical_expires_on DATE;
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS radio_channel TEXT;
-- Guardia: ubicación declarada al iniciarla (no hay registro de presencia real).
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS standby_location TEXT;
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS minutes_to_ramp SMALLINT
  CHECK (minutes_to_ramp >= 0);
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS standby_until TIMESTAMPTZ;

-- Se agrega vacation a los estados del tripulante.
ALTER TABLE public.crew_members DROP CONSTRAINT IF EXISTS crew_members_status_check;
ALTER TABLE public.crew_members ADD CONSTRAINT crew_members_status_check
  CHECK (status IN ('available', 'on_duty', 'in_flight', 'medical_leave', 'vacation'));

-- Tripulantes creados antes de rank: los pilotos quedan como primer oficial.
UPDATE public.crew_members SET rank = 'first_officer'
  WHERE rank IS NULL AND position ILIKE 'pilot%';
UPDATE public.crew_members SET rank = 'flight_attendant'
  WHERE rank IS NULL AND position ILIKE 'cabin%';

-- Ausencias: estado intermedio pending_ack (el reemplazo aún no confirma),
-- estado de la búsqueda de la IA y copia de los datos del vuelo para la cola.
ALTER TABLE public.absences DROP CONSTRAINT IF EXISTS absences_status_check;
ALTER TABLE public.absences ADD CONSTRAINT absences_status_check
  CHECK (status IN ('reported', 'pending_ack', 'covered', 'cancelled'));
ALTER TABLE public.absences ADD COLUMN IF NOT EXISTS suggestions_state TEXT;
-- error: la IA no pudo responder (se puede pedir otra ronda).
ALTER TABLE public.absences DROP CONSTRAINT IF EXISTS absences_suggestions_state_check;
ALTER TABLE public.absences ADD CONSTRAINT absences_suggestions_state_check
  CHECK (suggestions_state IN ('searching', 'ready', 'none', 'error'));
ALTER TABLE public.absences ADD COLUMN IF NOT EXISTS slot_role TEXT;
ALTER TABLE public.absences ADD COLUMN IF NOT EXISTS flight_origin TEXT;
ALTER TABLE public.absences ADD COLUMN IF NOT EXISTS flight_destination TEXT;
ALTER TABLE public.absences ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;
ALTER TABLE public.absences ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE public.absences ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Seguimiento: cuántos candidatos propuso la IA y qué opción de la lista se eligió.
ALTER TABLE public.absences ADD COLUMN IF NOT EXISTS candidate_count SMALLINT;
ALTER TABLE public.absences ADD COLUMN IF NOT EXISTS replacement_option SMALLINT;

CREATE INDEX IF NOT EXISTS absences_status_idx ON public.absences (status);

-- request_number: número consecutivo de la solicitud. La API lo muestra como code (SOL-00042).
-- Las ausencias que ya existían reciben su número al agregar la columna.
ALTER TABLE public.absences
  ADD COLUMN IF NOT EXISTS request_number BIGINT GENERATED BY DEFAULT AS IDENTITY;

-- Línea de tiempo de cada ausencia (pantalla de Seguimiento).
CREATE TABLE IF NOT EXISTS public.absence_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  absence_id UUID        NOT NULL REFERENCES public.absences (id) ON DELETE CASCADE,
  type       TEXT        NOT NULL
    CHECK (type IN ('reported', 'ai_ready', 'ai_none', 'ai_error', 'approved',
                    'candidate_missed', 'acknowledged', 'covered', 'cancelled')),
  text       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bases creadas antes de ai_error.
ALTER TABLE public.absence_events DROP CONSTRAINT IF EXISTS absence_events_type_check;
ALTER TABLE public.absence_events ADD CONSTRAINT absence_events_type_check
  CHECK (type IN ('reported', 'ai_ready', 'ai_none', 'ai_error', 'approved',
                  'candidate_missed', 'acknowledged', 'covered', 'cancelled'));

CREATE INDEX IF NOT EXISTS absence_events_absence_id_idx
  ON public.absence_events (absence_id, created_at);

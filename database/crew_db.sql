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

-- Base (hub) del tripulante, código IATA. No es current_location: esa es dónde
-- está ahora y la usa recommendation; la base es fija y la asigna Admin.
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS base VARCHAR(3);

-- Código de empleado que Crew asigna cuando Admin crea un tripulante sin código:
-- AC-0001, AC-0002… Si uno ya existe (asignado a mano), se usa el siguiente.
CREATE SEQUENCE IF NOT EXISTS public.crew_employee_code_seq;

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

-- Ausencias por fechas: el vuelo pasa a ser opcional. Las filas antiguas por
-- vuelo siguen valiendo (sus fechas quedan en NULL y el CHECK las acepta).
ALTER TABLE public.absences ALTER COLUMN flight_id DROP NOT NULL;
ALTER TABLE public.absences ALTER COLUMN flight_number DROP NOT NULL;
ALTER TABLE public.absences ALTER COLUMN flight_departure_at DROP NOT NULL;
ALTER TABLE public.absences ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE public.absences ADD COLUMN IF NOT EXISTS end_date DATE;

-- Los ALTER de restricciones van en DO para poder ejecutar el script varias veces.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.absences'::regclass
      AND conname = 'absences_dates_check'
  ) THEN
    ALTER TABLE public.absences
      ADD CONSTRAINT absences_dates_check CHECK (end_date >= start_date);
  END IF;
END $$;

-- Las dos fechas van juntas: ambas o ninguna.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.absences'::regclass
      AND conname = 'absences_date_pair_check'
  ) THEN
    ALTER TABLE public.absences
      ADD CONSTRAINT absences_date_pair_check
      CHECK ((start_date IS NULL) = (end_date IS NULL));
  END IF;
END $$;

-- Toda ausencia es por vuelo (las antiguas) o por fechas.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.absences'::regclass
      AND conname = 'absences_flight_or_dates_check'
  ) THEN
    ALTER TABLE public.absences
      ADD CONSTRAINT absences_flight_or_dates_check
      CHECK (flight_id IS NOT NULL OR start_date IS NOT NULL);
  END IF;
END $$;

-- Comprobante de la ausencia (PDF, PNG o JPG de hasta 10 MB). Se guarda en la
-- base porque el despliegue no tiene disco persistente. Las consultas de la
-- lista y del detalle solo leen los metadatos; data se lee al descargar.
CREATE TABLE IF NOT EXISTS public.absence_attachments (
  absence_id UUID        PRIMARY KEY REFERENCES public.absences(id) ON DELETE CASCADE,
  file_name  TEXT        NOT NULL,
  mime_type  TEXT        NOT NULL
    CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes INTEGER     NOT NULL,
  data       BYTEA       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tamaño entre 1 byte y 10 MB, el mismo límite que valida el servicio.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.absence_attachments'::regclass
      AND conname = 'absence_attachments_size_check'
  ) THEN
    ALTER TABLE public.absence_attachments
      ADD CONSTRAINT absence_attachments_size_check
      CHECK (size_bytes BETWEEN 1 AND 10485760);
  END IF;
END $$;
-- ===== Supervisor, programación y recomendaciones =====

-- Datos que usan las reglas de elegibilidad y la pantalla de Tripulación.
-- rank: cargo a bordo · ratings: familias de avión habilitadas (A320, 787...)
-- english_level: nivel OACI (1 a 6) · status on_duty = de guardia en el aeropuerto.
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS rank TEXT
  CHECK (rank IN ('captain', 'first_officer', 'purser', 'flight_attendant'));
-- base_code: columna anterior a base. La base del tripulante es base (la asigna Admin);
-- se copia una sola vez para las bases creadas antes y ya no se escribe.
ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS base_code TEXT;
UPDATE public.crew_members SET base = base_code WHERE base IS NULL AND base_code IS NOT NULL;
-- Las bases son los hubs de Delta. BOG, MDE y CLO (datos de demo antiguos) quedan
-- sin base, como en admin_db.sql; se limpian las dos columnas para que la copia de
-- arriba no las vuelva a poner en la siguiente ejecución.
UPDATE public.crew_members
SET base = NULL, base_code = NULL
WHERE base IN ('BOG', 'MDE', 'CLO') OR base_code IN ('BOG', 'MDE', 'CLO');
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

-- parent_absence_id: una ausencia por fechas genera una ausencia por vuelo (su solicitud
-- de reemplazo) por cada vuelo del tripulante en esas fechas; aquí queda de cuál salió.
ALTER TABLE public.absences ADD COLUMN IF NOT EXISTS parent_absence_id UUID
  REFERENCES public.absences (id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS absences_parent_idx ON public.absences (parent_absence_id);

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

-- ===== Certificaciones FAA (pantalla Certificaciones del super_admin) =====

-- Una certificación por tripulante; sin fila, está «sin certificado». La
-- registran, editan, verifican y eliminan solo los super_admin.
CREATE TABLE IF NOT EXISTS public.crew_certifications (
  crew_user_id   UUID        PRIMARY KEY
    REFERENCES public.crew_members (user_id) ON DELETE CASCADE,
  license_number VARCHAR(10) NOT NULL CHECK (license_number ~ '^[0-9]{5,10}$'),
  certificates   TEXT[]      NOT NULL CHECK (cardinality(certificates) > 0),
  status         TEXT        NOT NULL
    CHECK (status IN ('verified', 'pending_verification')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Copia del certificado (PDF, PNG o JPG de hasta 5 MB). data solo se lee al descargar.
CREATE TABLE IF NOT EXISTS public.crew_certification_files (
  crew_user_id UUID        PRIMARY KEY
    REFERENCES public.crew_certifications (crew_user_id) ON DELETE CASCADE,
  file_name    TEXT        NOT NULL,
  mime_type    TEXT        NOT NULL
    CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes   INTEGER     NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  data         BYTEA       NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Historial: registrado, verificado y actualizado. actor_user_id es el super_admin
-- en admin_db. clock_timestamp(): los eventos de un mismo guardado quedan en orden.
CREATE TABLE IF NOT EXISTS public.crew_certification_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_user_id  UUID        NOT NULL
    REFERENCES public.crew_certifications (crew_user_id) ON DELETE CASCADE,
  event         TEXT        NOT NULL CHECK (event IN ('registered', 'verified', 'updated')),
  actor_user_id UUID        NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS crew_certification_events_user_created_idx
  ON public.crew_certification_events (crew_user_id, created_at DESC);

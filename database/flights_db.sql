-- Base del servicio Flights. Crear antes la base: CREATE DATABASE flights_db;
-- Ejecutar conectado a flights_db.

-- Aeronaves de la flota. name, capacity y minimum_crew se guardan con los datos
-- del modelo (catálogo en services/flights/src/domain/aircraftCatalog.js).
CREATE TABLE IF NOT EXISTS public.aircraft (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  registration     TEXT        NOT NULL UNIQUE,
  msn              TEXT,
  model_id         TEXT,
  base             VARCHAR(3),
  manufacture_year INTEGER,
  in_fleet_since   DATE,
  flight_hours     INTEGER     NOT NULL DEFAULT 0 CHECK (flight_hours >= 0),
  cycles           INTEGER     NOT NULL DEFAULT 0 CHECK (cycles >= 0),
  capacity         INTEGER     NOT NULL CHECK (capacity > 0),
  minimum_crew     INTEGER     NOT NULL CHECK (minimum_crew >= 0),
  status           TEXT        NOT NULL DEFAULT 'operating'
    CHECK (status IN ('operating', 'maintenance', 'inactive')),
  maintenance_type TEXT,
  maintenance_note TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bases creadas antes de la pantalla Aeronaves: columnas nuevas y fuera los
-- destinos, que son del vuelo y nadie usaba. Las columnas nuevas quedan opcionales
-- para no romper filas antiguas; el servicio las exige al registrar o editar.
ALTER TABLE public.aircraft ADD COLUMN IF NOT EXISTS msn TEXT;
ALTER TABLE public.aircraft ADD COLUMN IF NOT EXISTS model_id TEXT;
ALTER TABLE public.aircraft ADD COLUMN IF NOT EXISTS base VARCHAR(3);
ALTER TABLE public.aircraft ADD COLUMN IF NOT EXISTS manufacture_year INTEGER;
ALTER TABLE public.aircraft ADD COLUMN IF NOT EXISTS in_fleet_since DATE;
ALTER TABLE public.aircraft ADD COLUMN IF NOT EXISTS flight_hours INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.aircraft ADD COLUMN IF NOT EXISTS cycles INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.aircraft ADD COLUMN IF NOT EXISTS maintenance_type TEXT;
ALTER TABLE public.aircraft ADD COLUMN IF NOT EXISTS maintenance_note TEXT;
ALTER TABLE public.aircraft DROP COLUMN IF EXISTS initial_destination;
ALTER TABLE public.aircraft DROP COLUMN IF EXISTS final_destination;

-- Motivo del mantenimiento: uno del catálogo y solo en mantenimiento. NOT VALID:
-- no revisa filas antiguas, solo las que se guarden desde ahora.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.aircraft'::regclass
      AND conname = 'aircraft_maintenance_check'
  ) THEN
    ALTER TABLE public.aircraft
      ADD CONSTRAINT aircraft_maintenance_check CHECK (
        (status = 'maintenance' AND maintenance_type IN (
          'motor', 'ala', 'tren_aterrizaje', 'fuselaje', 'electrico',
          'hidraulico', 'revision_programada'))
        OR (status <> 'maintenance' AND maintenance_type IS NULL AND maintenance_note IS NULL)
      ) NOT VALID;
  END IF;
END $$;

-- Foto de la aeronave, como la foto de perfil de Admin: PNG, JPEG o WEBP de hasta 2 MB.
CREATE TABLE IF NOT EXISTS public.aircraft_photos (
  aircraft_id UUID        PRIMARY KEY REFERENCES public.aircraft (id) ON DELETE CASCADE,
  mime_type   TEXT        NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes  INTEGER     NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
  data        BYTEA       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Órdenes de taller. La abierta (closed_on NULL) es el mantenimiento en curso;
-- las cerradas son el historial. tasks_done va en el orden de las tareas del motivo.
CREATE SEQUENCE IF NOT EXISTS public.maintenance_order_seq;

CREATE TABLE IF NOT EXISTS public.aircraft_maintenance_orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id  UUID        NOT NULL REFERENCES public.aircraft (id) ON DELETE CASCADE,
  order_number TEXT        NOT NULL UNIQUE DEFAULT (
    'OT-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.maintenance_order_seq')::text, 4, '0')
  ),
  type         TEXT        NOT NULL CHECK (type IN (
    'motor', 'ala', 'tren_aterrizaje', 'fuselaje', 'electrico',
    'hidraulico', 'revision_programada')),
  description  TEXT,
  hangar       TEXT        NOT NULL,
  tasks_done   BOOLEAN[]   NOT NULL,
  opened_on    DATE        NOT NULL DEFAULT CURRENT_DATE,
  closed_on    DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una sola orden abierta por aeronave.
CREATE UNIQUE INDEX IF NOT EXISTS aircraft_maintenance_orders_open_unique
  ON public.aircraft_maintenance_orders (aircraft_id)
  WHERE closed_on IS NULL;

-- Fechas en UTC (TIMESTAMPTZ). La conversión a hora local la hace el frontend.
CREATE TABLE IF NOT EXISTS public.flights (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_number TEXT        NOT NULL UNIQUE,
  aircraft_id   UUID        NOT NULL REFERENCES public.aircraft (id),
  origin        TEXT        NOT NULL,
  destination   TEXT        NOT NULL,
  departure_at  TIMESTAMPTZ NOT NULL,
  arrival_at    TIMESTAMPTZ NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'delayed', 'in_flight', 'completed', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (arrival_at > departure_at),
  CHECK (origin <> destination)
);

CREATE INDEX IF NOT EXISTS flights_departure_at_idx ON public.flights (departure_at);

-- Tripulantes asignados a cada vuelo. crew_user_id es el id del usuario en
-- admin_db (el "sub" del token); no hay llave foránea porque es otra base.
CREATE TABLE IF NOT EXISTS public.flight_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_id    UUID        NOT NULL REFERENCES public.flights (id),
  crew_user_id UUID        NOT NULL,
  role         TEXT        NOT NULL
    CHECK (role IN ('captain', 'first_officer', 'purser', 'flight_attendant')),
  status       TEXT        NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'replaced')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (flight_id, crew_user_id)
);

CREATE INDEX IF NOT EXISTS flight_assignments_crew_user_id_idx
  ON public.flight_assignments (crew_user_id);

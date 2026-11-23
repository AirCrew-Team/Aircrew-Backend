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

-- La base de una aeronave es un hub de Delta (AIRCRAFT_BASES). Las de los datos
-- de demo antiguos (Colombia) quedan sin base: la columna admite NULL y el
-- formulario pide elegir un hub al editarla.
UPDATE public.aircraft SET base = NULL WHERE base IN ('BOG', 'MDE', 'CLO');

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
  flight_number TEXT        NOT NULL,
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

-- ===== Programación y reemplazos =====

-- Catálogo de aeropuertos: ciudad, nombre y zona horaria para el frontend.
-- country decide si un vuelo es internacional: es doméstico solo si sus dos
-- aeropuertos están aquí con country US (uno que falta cuenta como internacional).
CREATE TABLE IF NOT EXISTS public.airports (
  code     TEXT PRIMARY KEY,
  icao     TEXT NOT NULL,
  city     TEXT NOT NULL,
  name     TEXT NOT NULL,
  country  TEXT NOT NULL,
  timezone TEXT NOT NULL
);

-- Fuera los aeropuertos colombianos de los datos de demo antiguos, salvo los que
-- algún vuelo todavía usa: sin su fila, ese vuelo perdería su ciudad y su nombre.
-- Los demás destinos (los del seed o los que se agreguen a mano) no se tocan.
DELETE FROM public.airports a
WHERE a.code IN ('BOG', 'MDE', 'CLO', 'CTG')
  AND NOT EXISTS (
    SELECT 1 FROM public.flights f
    WHERE f.origin = a.code OR f.destination = a.code
  );

-- Los 9 hubs de Delta, con los mismos datos que shared/domain/hubs.js (un test lo
-- comprueba). Repetible. Los destinos internacionales se agregan aparte.
INSERT INTO public.airports (code, icao, city, name, country, timezone) VALUES
  ('ATL', 'KATL', 'Atlanta', 'Hartsfield-Jackson Atlanta International', 'US', 'America/New_York'),
  ('BOS', 'KBOS', 'Boston', 'Boston Logan International', 'US', 'America/New_York'),
  ('DTW', 'KDTW', 'Detroit', 'Detroit Metropolitan Wayne County', 'US', 'America/Detroit'),
  ('LAX', 'KLAX', 'Los Ángeles', 'Los Angeles International', 'US', 'America/Los_Angeles'),
  ('MSP', 'KMSP', 'Minneapolis-St. Paul', 'Minneapolis-Saint Paul International', 'US', 'America/Chicago'),
  ('JFK', 'KJFK', 'Nueva York', 'John F. Kennedy International', 'US', 'America/New_York'),
  ('LGA', 'KLGA', 'Nueva York', 'LaGuardia', 'US', 'America/New_York'),
  ('SLC', 'KSLC', 'Salt Lake City', 'Salt Lake City International', 'US', 'America/Denver'),
  ('SEA', 'KSEA', 'Seattle', 'Seattle-Tacoma International', 'US', 'America/Los_Angeles')
ON CONFLICT (code) DO UPDATE SET icao = EXCLUDED.icao, city = EXCLUDED.city, name = EXCLUDED.name,
  country = EXCLUDED.country, timezone = EXCLUDED.timezone;

-- Destinos que no son base (los mismos del seed). Repetible.
INSERT INTO public.airports (code, icao, city, name, country, timezone) VALUES
  ('CDG', 'LFPG', 'París', 'Paris-Charles de Gaulle', 'FR', 'Europe/Paris'),
  ('LHR', 'EGLL', 'Londres', 'London Heathrow', 'GB', 'Europe/London'),
  ('CUN', 'MMUN', 'Cancún', 'Cancún International', 'MX', 'America/Cancun')
ON CONFLICT (code) DO UPDATE SET icao = EXCLUDED.icao, city = EXCLUDED.city, name = EXCLUDED.name,
  country = EXCLUDED.country, timezone = EXCLUDED.timezone;

-- Coordenadas de cada aeropuerto (grados decimales, WGS84). El formulario «Crear vuelo»
-- las usa para estimar la duración de la ruta y proponer la llegada. Repetible.
ALTER TABLE public.airports ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE public.airports ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
UPDATE public.airports AS a SET latitude = c.latitude, longitude = c.longitude
FROM (VALUES
  ('ATL', 33.6407, -84.4277),
  ('BOS', 42.3656, -71.0096),
  ('DTW', 42.2162, -83.3554),
  ('LAX', 33.9416, -118.4085),
  ('MSP', 44.8848, -93.2223),
  ('JFK', 40.6413, -73.7781),
  ('LGA', 40.7769, -73.8740),
  ('SLC', 40.7899, -111.9791),
  ('SEA', 47.4502, -122.3088),
  ('CDG', 49.0097, 2.5479),
  ('LHR', 51.4700, -0.4543),
  ('CUN', 21.0365, -86.8771)
) AS c(code, latitude, longitude)
WHERE a.code = c.code;

-- Un número de vuelo se repite cada día: es único por (número, día UTC de la salida).
ALTER TABLE public.flights DROP CONSTRAINT IF EXISTS flights_flight_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS flights_number_day_unique
  ON public.flights (flight_number, ((departure_at AT TIME ZONE 'UTC')::date));
CREATE INDEX IF NOT EXISTS flights_aircraft_departure_idx
  ON public.flights (aircraft_id, departure_at);

-- family: familia del avión (A320, 787...). La usa la regla de habilitación.
ALTER TABLE public.aircraft ADD COLUMN IF NOT EXISTS family TEXT;

-- Aeronaves registradas desde la pantalla Aeronaves antes de guardar la familia:
-- se completa con la del modelo (la misma de domain/aircraftCatalog.js). Repetible.
UPDATE public.aircraft SET family = CASE model_id
    WHEN 'a321neo' THEN 'A320'
    WHEN 'b739' THEN '737'
    WHEN 'a220' THEN 'A220'
    WHEN 'a330neo' THEN 'A330'
    WHEN 'a350' THEN 'A350'
    WHEN 'b764' THEN '767'
    WHEN 'e175' THEN 'E175'
  END
WHERE family IS NULL
  AND model_id IN ('a321neo', 'b739', 'a220', 'a330neo', 'a350', 'b764', 'e175');

-- gate: puerta de embarque · crew_confirmed_at: el supervisor confirmó la tripulación.
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS gate TEXT;
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS crew_confirmed_at TIMESTAMPTZ;
ALTER TABLE public.flights ADD COLUMN IF NOT EXISTS crew_confirmed_by UUID;

-- slot_id: puesto que ocupa (captain, first_officer, relief, purser, fa-1...).
-- source: quién la propuso · rationale: explicación de la IA o de la regla.
-- Reemplazos: is_replacement, quién aprobó y plazo para dar «Enterado».
ALTER TABLE public.flight_assignments ADD COLUMN IF NOT EXISTS slot_id TEXT;
ALTER TABLE public.flight_assignments ADD COLUMN IF NOT EXISTS source TEXT NOT NULL
  DEFAULT 'manual' CHECK (source IN ('manual', 'ai', 'rule'));
ALTER TABLE public.flight_assignments ADD COLUMN IF NOT EXISTS rationale TEXT;
ALTER TABLE public.flight_assignments ADD COLUMN IF NOT EXISTS is_replacement BOOLEAN
  NOT NULL DEFAULT false;
ALTER TABLE public.flight_assignments ADD COLUMN IF NOT EXISTS replacement_reason TEXT;
ALTER TABLE public.flight_assignments ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE public.flight_assignments ADD COLUMN IF NOT EXISTS approved_by_name TEXT;
ALTER TABLE public.flight_assignments ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.flight_assignments ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;
ALTER TABLE public.flight_assignments ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

-- Un puesto activo solo puede tener una persona.
CREATE UNIQUE INDEX IF NOT EXISTS flight_assignments_active_slot_unique
  ON public.flight_assignments (flight_id, slot_id)
  WHERE status = 'assigned' AND slot_id IS NOT NULL;

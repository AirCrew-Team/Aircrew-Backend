-- Base del servicio Flights. Crear antes la base: CREATE DATABASE flights_db;
-- Ejecutar conectado a flights_db.

CREATE TABLE IF NOT EXISTS public.aircraft (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  registration        TEXT        NOT NULL UNIQUE,
  capacity            INTEGER     NOT NULL CHECK (capacity > 0),
  minimum_crew        INTEGER     NOT NULL CHECK (minimum_crew >= 0),
  initial_destination TEXT        NOT NULL,
  final_destination   TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'operating'
    CHECK (status IN ('operating', 'maintenance', 'inactive')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

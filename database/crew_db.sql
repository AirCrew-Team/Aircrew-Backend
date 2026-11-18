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

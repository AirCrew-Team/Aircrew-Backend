-- Base del servicio Admin. Crear antes la base: CREATE DATABASE admin_db;
-- Ejecutar conectado a admin_db.

CREATE TABLE IF NOT EXISTS public.users (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      VARCHAR(100) NOT NULL,
  email                     VARCHAR(255) NOT NULL UNIQUE,
  password_hash             VARCHAR(255) NOT NULL,
  role                      VARCHAR(30)  NOT NULL,
  is_active                 BOOLEAN      NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activation_token_hash     TEXT,
  activation_expires_at     TIMESTAMPTZ,
  password_reset_token_hash TEXT,
  password_reset_expires_at TIMESTAMPTZ,
  phone                     VARCHAR(20),
  residence                 VARCHAR(100),
  password_changed_at       TIMESTAMPTZ,
  notify_absence_reported   BOOLEAN      NOT NULL DEFAULT true,
  notify_absence_covered    BOOLEAN      NOT NULL DEFAULT true,
  notify_replacement_assigned BOOLEAN    NOT NULL DEFAULT true,
  employee_code             VARCHAR(30),
  base                      VARCHAR(3)
    CONSTRAINT users_base_check
    CHECK (base IN ('ATL', 'BOS', 'DTW', 'LAX', 'MSP', 'JFK', 'LGA', 'SLC', 'SEA')),
  shift                     TEXT
    CONSTRAINT users_shift_check
    CHECK (shift IN ('morning', 'afternoon', 'night')),
  operational_status        TEXT
    CONSTRAINT users_operational_status_check
    CHECK (operational_status IN ('available', 'on_duty', 'off_duty', 'leave'))
);

-- Bases creadas antes de la recuperación de contraseña. Van antes del índice,
-- que usa la columna.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;

-- Bases creadas antes de Configuración: contacto, fecha del último cambio de
-- contraseña y preferencias de notificaciones. password_changed_at queda en
-- null en las filas que ya existen.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS residence VARCHAR(100);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_absence_reported BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_absence_covered BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_replacement_assigned BOOLEAN NOT NULL DEFAULT true;

-- Bases creadas antes de los datos laborales del supervisor (los asigna un
-- super_admin). Las demás cuentas los dejan en null.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS employee_code VARCHAR(30);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS base VARCHAR(3);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS shift TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS operational_status TEXT;

-- Las bases son los 9 hubs de Delta (shared/domain/hubs.js). BOG, MDE y CLO eran
-- de los datos de demo antiguos: los supervisores que las tenían quedan sin base
-- (un super_admin les asigna un hub). Va antes del CHECK, que ya no las admite.
UPDATE public.users
SET base = NULL
WHERE base IN ('BOG', 'MDE', 'CLO');

-- Los ALTER de restricciones van en DO para poder ejecutar el script varias veces.
DO $$
BEGIN
  -- Se vuelve a crear siempre para que un cambio en la lista llegue a las bases ya creadas.
  ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_base_check;
  ALTER TABLE public.users
    ADD CONSTRAINT users_base_check
    CHECK (base IN ('ATL', 'BOS', 'DTW', 'LAX', 'MSP', 'JFK', 'LGA', 'SLC', 'SEA'));

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_shift_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_shift_check
      CHECK (shift IN ('morning', 'afternoon', 'night'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_operational_status_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_operational_status_check
      CHECK (operational_status IN ('available', 'on_duty', 'off_duty', 'leave'));
  END IF;

  -- Solo los supervisores tienen datos laborales. Cubre un cambio de rol entre
  -- la lectura y el UPDATE de PATCH /users/:id: userRepository lo responde con
  -- un 409. Al crearla, PostgreSQL comprueba también las filas que ya existen.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_employment_supervisor_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_employment_supervisor_check
      CHECK (role = 'supervisor' OR (employee_code IS NULL AND base IS NULL AND shift IS NULL AND operational_status IS NULL));
  END IF;
END $$;

-- Los supervisores que ya existían empiezan disponibles, como uno nuevo.
UPDATE public.users
SET operational_status = 'available'
WHERE role = 'supervisor'
  AND operational_status IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_activation_token_hash_unique
  ON public.users (activation_token_hash)
  WHERE activation_token_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_password_reset_token_hash_unique
  ON public.users (password_reset_token_hash)
  WHERE password_reset_token_hash IS NOT NULL;

-- Código de empleado único entre los supervisores (solo ellos lo tienen).
-- El nombre lo usa userRepository para responder 409 con su propio mensaje.
CREATE UNIQUE INDEX IF NOT EXISTS users_employee_code_unique
  ON public.users (employee_code)
  WHERE employee_code IS NOT NULL;

-- Solicitudes de enlace, cambios de contraseña y contraseñas actuales incorrectas
-- en el cambio con sesión (change_failed): sirven para los límites por cuenta.
CREATE TABLE IF NOT EXISTS public.password_reset_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  event      VARCHAR(20) NOT NULL
    CONSTRAINT password_reset_events_event_check
    CHECK (event IN ('requested', 'changed', 'change_failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Bases creadas antes de change_failed: se vuelve a crear el CHECK (repetible).
ALTER TABLE public.password_reset_events DROP CONSTRAINT IF EXISTS password_reset_events_event_check;
ALTER TABLE public.password_reset_events
  ADD CONSTRAINT password_reset_events_event_check
  CHECK (event IN ('requested', 'changed', 'change_failed'));

CREATE INDEX IF NOT EXISTS password_reset_events_user_event_created_idx
  ON public.password_reset_events (user_id, event, created_at);

-- Fallos de login por correo normalizado (exista o no la cuenta): 5 en 15 min dan 429.
-- TEXT: el correo que se escribe en el login no tiene un largo máximo.
CREATE TABLE IF NOT EXISTS public.login_failures (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS login_failures_email_created_idx
  ON public.login_failures (email, created_at);

-- Foto de perfil: una por cuenta, PNG, JPEG o WEBP de hasta 2 MB.
CREATE TABLE IF NOT EXISTS public.user_photos (
  user_id    UUID        PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
  mime_type  TEXT        NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes INTEGER     NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
  data       BYTEA       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Bases de operación. code es el IATA del aeropuerto de la base.
CREATE TABLE IF NOT EXISTS public.bases (
  code                  TEXT PRIMARY KEY,
  icao                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  city                  TEXT NOT NULL,
  unit                  TEXT NOT NULL,
  hq_code               TEXT NOT NULL,
  operational_condition TEXT NOT NULL DEFAULT 'normal'
    CHECK (operational_condition IN ('normal', 'degraded', 'critical'))
);

-- Fuera las bases de los datos de demo antiguos (Colombia): ningún usuario puede
-- tenerlas (CHECK de users.base) y ninguna llave foránea apunta a esta tabla.
DELETE FROM public.bases WHERE code IN ('BOG', 'MDE', 'CLO');

-- Los 9 hubs de Delta, con los mismos datos que shared/domain/hubs.js (un test lo
-- comprueba). Repetible: actualiza los datos fijos y no toca operational_condition.
INSERT INTO public.bases (code, icao, name, city, unit, hq_code) VALUES
  ('ATL', 'KATL', 'Hartsfield-Jackson Atlanta International', 'Atlanta', 'Operaciones de Vuelo Atlanta', 'ATL-HQ'),
  ('BOS', 'KBOS', 'Boston Logan International', 'Boston', 'Operaciones de Vuelo Boston', 'BOS-HQ'),
  ('DTW', 'KDTW', 'Detroit Metropolitan Wayne County', 'Detroit', 'Operaciones de Vuelo Detroit', 'DTW-HQ'),
  ('LAX', 'KLAX', 'Los Angeles International', 'Los Ángeles', 'Operaciones de Vuelo Los Ángeles', 'LAX-HQ'),
  ('MSP', 'KMSP', 'Minneapolis-Saint Paul International', 'Minneapolis-St. Paul', 'Operaciones de Vuelo Minneapolis', 'MSP-HQ'),
  ('JFK', 'KJFK', 'John F. Kennedy International', 'Nueva York', 'Operaciones de Vuelo Nueva York JFK', 'JFK-HQ'),
  ('LGA', 'KLGA', 'LaGuardia', 'Nueva York', 'Operaciones de Vuelo Nueva York LaGuardia', 'LGA-HQ'),
  ('SLC', 'KSLC', 'Salt Lake City International', 'Salt Lake City', 'Operaciones de Vuelo Salt Lake City', 'SLC-HQ'),
  ('SEA', 'KSEA', 'Seattle-Tacoma International', 'Seattle', 'Operaciones de Vuelo Seattle', 'SEA-HQ')
ON CONFLICT (code) DO UPDATE SET icao = EXCLUDED.icao, name = EXCLUDED.name, city = EXCLUDED.city,
  unit = EXCLUDED.unit, hq_code = EXCLUDED.hq_code;

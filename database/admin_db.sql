-- Base del servicio Admin. Crear antes la base: CREATE DATABASE admin_db;
-- Ejecutar conectado a admin_db.

CREATE TABLE IF NOT EXISTS public.users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(100) NOT NULL,
  email                 VARCHAR(255) NOT NULL UNIQUE,
  password_hash         VARCHAR(255) NOT NULL,
  role                  VARCHAR(30)  NOT NULL,
  is_active             BOOLEAN      NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activation_token_hash TEXT,
  activation_expires_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS users_activation_token_hash_unique
  ON public.users (activation_token_hash)
  WHERE activation_token_hash IS NOT NULL;

-- Perfil del usuario (supervisor y administrador). ALTER para bases ya creadas.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS base_code TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS shift TEXT
  CHECK (shift IN ('morning', 'afternoon', 'night'));
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notification_preferences JSONB
  NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

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

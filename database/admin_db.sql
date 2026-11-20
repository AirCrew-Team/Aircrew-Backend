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
  password_reset_expires_at TIMESTAMPTZ
);

-- Bases creadas antes de la recuperación de contraseña. Van antes del índice,
-- que usa la columna.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS users_activation_token_hash_unique
  ON public.users (activation_token_hash)
  WHERE activation_token_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_password_reset_token_hash_unique
  ON public.users (password_reset_token_hash)
  WHERE password_reset_token_hash IS NOT NULL;

-- Solicitudes de enlace y cambios de contraseña: sirven para los límites por cuenta.
CREATE TABLE IF NOT EXISTS public.password_reset_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  event      VARCHAR(20) NOT NULL CHECK (event IN ('requested', 'changed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS password_reset_events_user_event_created_idx
  ON public.password_reset_events (user_id, event, created_at);

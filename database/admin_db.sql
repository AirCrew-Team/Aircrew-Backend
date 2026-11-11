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

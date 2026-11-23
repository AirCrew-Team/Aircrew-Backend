-- Base del servicio Notification. Crear antes la base: CREATE DATABASE notification_db;
-- Ejecutar conectado a notification_db. Se puede volver a ejecutar sin error.

-- Historial de la campana. Cada aviso es para una persona o para un rol:
--   - user_id: aviso para un tripulante (reemplazo asignado, certificado registrado
--     o verificado). Es el id del usuario en admin_db; no hay llave foránea porque es otra base.
--   - audience_role: alerta para todos los de ese rol (hoy, 'supervisor': ausencias).
--     Se guarda una sola vez y cada supervisor la ve en su campana, aunque no estuviera conectado.
-- data guarda los datos del aviso (vuelo, plazo, ausencia, certificado…) tal como se enviaron en vivo.
CREATE TABLE IF NOT EXISTS public.notifications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID,
  audience_role TEXT,
  type          TEXT        NOT NULL,
  message       TEXT        NOT NULL,
  data          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notifications_one_audience_chk
    CHECK ((user_id IS NULL) <> (audience_role IS NULL))
);

-- Quién leyó qué: una fila por aviso y persona. Sirve igual para los avisos
-- personales y para las alertas del rol (cada supervisor marca las suyas).
CREATE TABLE IF NOT EXISTS public.notification_reads (
  notification_id UUID        NOT NULL REFERENCES public.notifications (id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

-- La campana pide los avisos de una persona y los de su rol, los más recientes primero.
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_role_created_idx
  ON public.notifications (audience_role, created_at DESC)
  WHERE audience_role IS NOT NULL;

CREATE INDEX IF NOT EXISTS notification_reads_user_idx
  ON public.notification_reads (user_id);

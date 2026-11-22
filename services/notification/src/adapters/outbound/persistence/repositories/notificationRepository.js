const pool = require('../pool');

// `viewer` es la persona con sesión: { id, role }. Ve los avisos dirigidos a ella
// y las alertas de su rol. Si leyó o no, sale de notification_reads.
const visibleTo = '(n.user_id = $1 OR n.audience_role = $2)';

// Guarda un aviso para una persona (userId) o para un rol (audienceRole).
async function insertNotification({ userId = null, audienceRole = null, type, message, data }) {
  const { rows } = await pool.query(
    `INSERT INTO public.notifications (user_id, audience_role, type, message, data)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, type, message, data, created_at`,
    [userId, audienceRole, type, message, data]
  );

  return rows[0];
}

// Los avisos que ve una persona, los más recientes primero, con su read_at.
async function findVisible(viewer, { limit }) {
  const { rows } = await pool.query(
    `SELECT n.id, n.type, n.message, n.data, r.read_at, n.created_at
     FROM public.notifications n
     LEFT JOIN public.notification_reads r
       ON r.notification_id = n.id AND r.user_id = $1
     WHERE ${visibleTo}
     ORDER BY n.created_at DESC
     LIMIT $3`,
    [viewer.id, viewer.role, limit]
  );

  return rows;
}

async function countUnread(viewer) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS unread
     FROM public.notifications n
     WHERE ${visibleTo}
       AND NOT EXISTS (
         SELECT 1 FROM public.notification_reads r
         WHERE r.notification_id = n.id AND r.user_id = $1
       )`,
    [viewer.id, viewer.role]
  );

  return rows[0].unread;
}

// Solo marca avisos que esa persona puede ver; devuelve null si no existe o no es suyo.
// Si ya estaba leído, conserva la fecha de la primera lectura.
async function markRead(viewer, id) {
  const { rows } = await pool.query(
    `WITH target AS (
       SELECT n.id, n.type, n.message, n.data, n.created_at
       FROM public.notifications n
       WHERE n.id = $3 AND ${visibleTo}
     ),
     inserted AS (
       INSERT INTO public.notification_reads (notification_id, user_id)
       SELECT id, $1 FROM target
       ON CONFLICT (notification_id, user_id) DO NOTHING
       RETURNING read_at
     )
     SELECT t.id, t.type, t.message, t.data, t.created_at,
            COALESCE(
              (SELECT read_at FROM inserted),
              (SELECT r.read_at FROM public.notification_reads r
               WHERE r.notification_id = t.id AND r.user_id = $1)
            ) AS read_at
     FROM target t`,
    [viewer.id, viewer.role, id]
  );

  return rows[0] || null;
}

// Marca todos los que ve esa persona; devuelve cuántos estaban sin leer.
async function markAllRead(viewer) {
  const { rowCount } = await pool.query(
    `INSERT INTO public.notification_reads (notification_id, user_id)
     SELECT n.id, $1
     FROM public.notifications n
     WHERE ${visibleTo}
     ON CONFLICT (notification_id, user_id) DO NOTHING`,
    [viewer.id, viewer.role]
  );

  return rowCount;
}

module.exports = { insertNotification, findVisible, countUnread, markRead, markAllRead };

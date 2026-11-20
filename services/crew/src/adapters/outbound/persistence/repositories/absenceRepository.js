const pool = require('../pool');

// Las fechas de solo día salen como texto: pg las convertiría a Date con la
// hora local y en JSON podrían cambiar de día.
const absenceColumns = `id, crew_user_id, flight_id, flight_number,
       flight_departure_at,
       to_char(start_date, 'YYYY-MM-DD') AS start_date,
       to_char(end_date, 'YYYY-MM-DD') AS end_date,
       reason, notes, status, replacement_user_id, covered_at, created_at`;

// Ausencia con el código y cargo del tripulante que se ausentó y los
// metadatos de su comprobante. Nunca trae los bytes del archivo.
const absenceWithCrewMember = `
  SELECT a.id, a.crew_user_id, a.flight_id, a.flight_number,
         a.flight_departure_at,
         to_char(a.start_date, 'YYYY-MM-DD') AS start_date,
         to_char(a.end_date, 'YYYY-MM-DD') AS end_date,
         a.reason, a.notes, a.status,
         a.replacement_user_id, a.covered_at, a.created_at,
         c.employee_code, c.position,
         CASE WHEN att.absence_id IS NULL THEN NULL
              ELSE json_build_object(
                'file_name', att.file_name,
                'mime_type', att.mime_type,
                'size_bytes', att.size_bytes
              )
         END AS attachment
  FROM public.absences a
  LEFT JOIN public.crew_members c ON c.user_id = a.crew_user_id
  LEFT JOIN public.absence_attachments att ON att.absence_id = a.id`;

// Consultas que solo existen dentro de withCrewMemberLock, con su cliente.
function transactionRepository(client) {
  return {
    // Las ausencias antiguas por vuelo no tienen fechas y no se cruzan.
    async hasOverlappingAbsence({ crewUserId, startDate, endDate }) {
      const { rows } = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM public.absences
           WHERE crew_user_id = $1 AND start_date <= $3 AND end_date >= $2
         )`,
        [crewUserId, startDate, endDate]
      );

      return rows[0].exists;
    },

    async insertAbsence({ crewUserId, startDate, endDate, reason, notes }) {
      const { rows } = await client.query(
        `INSERT INTO public.absences
           (crew_user_id, start_date, end_date, reason, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${absenceColumns}`,
        [crewUserId, startDate, endDate, reason, notes]
      );

      return rows[0];
    },

    async insertAttachment({ absenceId, fileName, mimeType, sizeBytes, data }) {
      const { rows } = await client.query(
        `INSERT INTO public.absence_attachments
           (absence_id, file_name, mime_type, size_bytes, data)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING file_name, mime_type, size_bytes`,
        [absenceId, fileName, mimeType, sizeBytes, data]
      );

      return rows[0];
    },
  };
}

// Transacción con el tripulante bloqueado hasta el COMMIT: sus reportes
// simultáneos corren en fila. Si `fn` falla, no queda nada guardado.
async function withCrewMemberLock(crewUserId, fn) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      crewUserId,
    ]);
    const result = await fn(transactionRepository(client));
    await client.query('COMMIT');
    client.release();
    return result;
  } catch (error) {
    // Si el ROLLBACK falla, la conexión se descarta (release con el error)
    // y se relanza el error original, no el del ROLLBACK.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      client.release(rollbackError);
      throw error;
    }
    client.release();
    throw error;
  }
}

// Las más recientes primero; `status` es opcional.
async function findAbsences({ status = null } = {}) {
  const { rows } = await pool.query(
    `${absenceWithCrewMember}
     WHERE ($1::text IS NULL OR a.status = $1)
     ORDER BY a.created_at DESC`,
    [status]
  );

  return rows;
}

async function findAbsenceById(id) {
  const { rows } = await pool.query(
    `${absenceWithCrewMember}
     WHERE a.id = $1`,
    [id]
  );

  return rows[0] || null;
}

// Comprobante con sus bytes, solo para la descarga.
async function findAttachment(absenceId) {
  const { rows } = await pool.query(
    `SELECT file_name, mime_type, data
     FROM public.absence_attachments
     WHERE absence_id = $1`,
    [absenceId]
  );

  return rows[0] || null;
}

// Solo cambia una ausencia que siga `reported`; si otra petición la cubrió
// primero, devuelve null.
async function markAbsenceCovered(id, replacementUserId) {
  const { rows } = await pool.query(
    `UPDATE public.absences
     SET status = 'covered', replacement_user_id = $2, covered_at = now()
     WHERE id = $1 AND status = 'reported'
     RETURNING ${absenceColumns}`,
    [id, replacementUserId]
  );

  return rows[0] || null;
}

module.exports = {
  withCrewMemberLock,
  findAbsences,
  findAbsenceById,
  findAttachment,
  markAbsenceCovered,
};

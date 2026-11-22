const pool = require('../pool');

// code: número de solicitud legible para el supervisor (SOL-00042).
// kind: flight (por vuelo, con su reemplazo) o dates (por fechas, con comprobante).
// parent_absence_id: la ausencia por fechas de la que salió una ausencia por vuelo.
// Las fechas de solo día salen como texto: pg las convertiría a Date con la
// hora local y en JSON podrían cambiar de día.
const absenceColumns = `id, 'SOL-' || lpad(request_number::text, 5, '0') AS code,
       CASE WHEN flight_id IS NULL THEN 'dates' ELSE 'flight' END AS kind,
       parent_absence_id, crew_user_id, flight_id, flight_number,
       flight_departure_at, flight_origin, flight_destination, slot_role,
       to_char(start_date, 'YYYY-MM-DD') AS start_date,
       to_char(end_date, 'YYYY-MM-DD') AS end_date,
       reason, notes, status, suggestions_state, replacement_user_id,
       approved_by, approved_at, deadline_at, candidate_count, replacement_option,
       covered_at, created_at`;

// Ausencia con el código, cargo y rango del tripulante que se ausentó y los
// metadatos de su comprobante (nunca los bytes del archivo).
const absenceWithCrewMember = `
  SELECT a.id, 'SOL-' || lpad(a.request_number::text, 5, '0') AS code,
         CASE WHEN a.flight_id IS NULL THEN 'dates' ELSE 'flight' END AS kind,
         a.parent_absence_id, a.crew_user_id, a.flight_id, a.flight_number,
         a.flight_departure_at, a.flight_origin, a.flight_destination,
         to_char(a.start_date, 'YYYY-MM-DD') AS start_date,
         to_char(a.end_date, 'YYYY-MM-DD') AS end_date,
         a.slot_role, a.reason, a.notes, a.status, a.suggestions_state,
         a.replacement_user_id, a.approved_by, a.approved_at, a.deadline_at,
         a.candidate_count, a.replacement_option,
         a.covered_at, a.created_at,
         c.employee_code, c.position, c.rank,
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
    // Solo se cruzan las ausencias por fechas; las ausencias por vuelo no tienen fechas.
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

    // Ausencia por vuelo que sale de una ausencia por fechas (su solicitud de reemplazo).
    // Si el tripulante ya había reportado ese vuelo, no se repite: devuelve null.
    async insertFlightAbsence(flightAbsence) {
      const { rows } = await client.query(
        `INSERT INTO public.absences
           (crew_user_id, flight_id, flight_number, flight_departure_at,
            flight_origin, flight_destination, slot_role, reason, notes,
            suggestions_state, parent_absence_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'searching', $10)
         ON CONFLICT (crew_user_id, flight_id) DO NOTHING
         RETURNING ${absenceColumns}`,
        flightAbsenceParams(flightAbsence)
      );

      return rows[0] || null;
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

function flightAbsenceParams({
  crewUserId,
  flightId,
  flightNumber,
  flightDepartureAt,
  flightOrigin,
  flightDestination,
  slotRole,
  reason,
  notes,
  parentAbsenceId = null,
}) {
  return [
    crewUserId,
    flightId,
    flightNumber,
    flightDepartureAt,
    flightOrigin,
    flightDestination,
    slotRole,
    reason,
    notes,
    parentAbsenceId,
  ];
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

// Ausencia por vuelo reportada directamente por el tripulante.
async function createAbsence(flightAbsence) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.absences
         (crew_user_id, flight_id, flight_number, flight_departure_at,
          flight_origin, flight_destination, slot_role, reason, notes,
          suggestions_state, parent_absence_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'searching', $10)
       RETURNING ${absenceColumns}`,
      flightAbsenceParams(flightAbsence)
    );

    return rows[0];
  } catch (cause) {
    if (cause.code === '23505') {
      const error = new Error('Ya reportaste una ausencia para este vuelo.');
      error.status = 409;
      error.code = 'duplicate_absence';
      throw error;
    }

    throw cause;
  }
}

// Con filtro de estado, ordenadas por la salida más próxima (la cola de
// solicitudes). Sin filtro, las más recientes primero.
// kind: flight (cola de reemplazos) o dates (ausencias por fechas). Sin kind, todas.
async function findAbsences({ status = null, kind = null } = {}) {
  const { rows } = await pool.query(
    `${absenceWithCrewMember}
     WHERE ($1::text IS NULL OR a.status = $1)
       AND ($2::text IS NULL
            OR ($2 = 'flight' AND a.flight_id IS NOT NULL)
            OR ($2 = 'dates' AND a.flight_id IS NULL))
     ORDER BY CASE WHEN $1::text IS NULL THEN NULL ELSE a.flight_departure_at END ASC NULLS LAST,
              a.created_at DESC`,
    [status, kind]
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

// Ausencias por vuelo que salieron de una ausencia por fechas.
async function findChildAbsences(parentAbsenceId) {
  const { rows } = await pool.query(
    `${absenceWithCrewMember}
     WHERE a.parent_absence_id = $1
     ORDER BY a.flight_departure_at`,
    [parentAbsenceId]
  );

  return rows;
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

async function updateSuggestionsState(id, state) {
  const { rows } = await pool.query(
    `UPDATE public.absences SET suggestions_state = $2
     WHERE id = $1
     RETURNING ${absenceColumns}`,
    [id, state]
  );

  return rows[0] || null;
}

// Línea de tiempo de la ausencia.
async function addAbsenceEvent(absenceId, type, text) {
  await pool.query(
    `INSERT INTO public.absence_events (absence_id, type, text) VALUES ($1, $2, $3)`,
    [absenceId, type, text]
  );
}

async function findAbsenceEvents(absenceId) {
  const { rows } = await pool.query(
    `SELECT type, text, created_at AS at
     FROM public.absence_events
     WHERE absence_id = $1
     ORDER BY created_at`,
    [absenceId]
  );

  return rows;
}

// El supervisor aprobó un reemplazo: queda esperando su «Enterado».
async function markAbsencePendingAck(id, { replacementUserId, approvedBy, deadlineAt, option }) {
  const { rows } = await pool.query(
    `UPDATE public.absences
     SET status = 'pending_ack', replacement_user_id = $2, approved_by = $3,
         approved_at = now(), deadline_at = $4, replacement_option = $5
     WHERE id = $1 AND status = 'reported'
     RETURNING ${absenceColumns}`,
    [id, replacementUserId, approvedBy, deadlineAt, option]
  );

  return rows[0] || null;
}

// El reemplazo dio «Enterado»: la ausencia de ese vuelo queda cubierta.
async function markAcknowledged(flightId, replacementUserId) {
  const { rows } = await pool.query(
    `UPDATE public.absences
     SET status = 'covered', covered_at = now()
     WHERE flight_id = $1 AND replacement_user_id = $2 AND status = 'pending_ack'
     RETURNING ${absenceColumns}`,
    [flightId, replacementUserId]
  );

  return rows[0] || null;
}

// El reemplazo dejó vencer el plazo: la ausencia vuelve a la cola.
async function markMissed(id) {
  const { rows } = await pool.query(
    `UPDATE public.absences
     SET status = 'reported', replacement_user_id = NULL, approved_by = NULL,
         approved_at = NULL, deadline_at = NULL, replacement_option = NULL
     WHERE id = $1 AND status = 'pending_ack'
     RETURNING ${absenceColumns}`,
    [id]
  );

  return rows[0] || null;
}

async function findExpiredPendingAck(now) {
  const { rows } = await pool.query(
    `${absenceWithCrewMember}
     WHERE a.status = 'pending_ack' AND a.deadline_at < $1
     ORDER BY a.deadline_at`,
    [now]
  );

  return rows;
}

async function setCandidateCount(id, count) {
  await pool.query('UPDATE public.absences SET candidate_count = $2 WHERE id = $1', [id, count]);
}

// Ausencias de los vuelos que salen en un día (hora de Colombia), para el
// seguimiento del turno.
async function findAbsencesByDepartureDay(day) {
  const { rows } = await pool.query(
    `${absenceWithCrewMember}
     WHERE (a.flight_departure_at AT TIME ZONE 'America/Bogota')::date = $1::date
       AND a.status <> 'cancelled'`,
    [day]
  );

  return rows;
}

async function findEventsByAbsences(absenceIds) {
  const { rows } = await pool.query(
    `SELECT absence_id, type, text, created_at AS at
     FROM public.absence_events
     WHERE absence_id = ANY($1::uuid[])
     ORDER BY created_at`,
    [absenceIds]
  );

  return rows;
}

// Indicadores para el inicio del supervisor: solo solicitudes por vuelo (las que
// se reemplazan). La tasa de resolución es sobre las de los últimos 30 días.
async function getAbsenceStats(now) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'reported')::int AS reported,
       COUNT(*) FILTER (WHERE status = 'pending_ack')::int AS pending_ack,
       COUNT(*) FILTER (WHERE status = 'covered'
         AND (covered_at AT TIME ZONE 'America/Bogota')::date
             = ($1::timestamptz AT TIME ZONE 'America/Bogota')::date)::int AS covered_today,
       COUNT(*) FILTER (WHERE status = 'covered' AND created_at >= $1::timestamptz - interval '30 days')::int AS covered_30d,
       COUNT(*) FILTER (WHERE status <> 'cancelled' AND created_at >= $1::timestamptz - interval '30 days')::int AS total_30d
     FROM public.absences
     WHERE flight_id IS NOT NULL`,
    [now]
  );

  return rows[0];
}

// Ausencias abiertas (por aprobar o esperando «Enterado»).
async function findOpenAbsences() {
  const { rows } = await pool.query(
    `${absenceWithCrewMember} WHERE a.status IN ('reported', 'pending_ack')`
  );
  return rows;
}

module.exports = {
  withCrewMemberLock,
  createAbsence,
  findAbsences,
  findAbsenceById,
  findChildAbsences,
  findAttachment,
  markAbsenceCovered,
  updateSuggestionsState,
  addAbsenceEvent,
  findAbsenceEvents,
  findOpenAbsences,
  markAbsencePendingAck,
  markAcknowledged,
  markMissed,
  findExpiredPendingAck,
  setCandidateCount,
  findAbsencesByDepartureDay,
  findEventsByAbsences,
  getAbsenceStats,
};

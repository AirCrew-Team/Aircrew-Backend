const pool = require('../pool');

// Asignación junto con su vuelo y aeronave, como la necesita el frontend.
const assignmentWithFlight = `
  SELECT a.id, a.crew_user_id, a.role, a.status, a.created_at, a.slot_id,
         a.source, a.is_replacement, a.replacement_reason, a.approved_by_name,
         a.approved_at, a.deadline_at, a.acknowledged_at,
         f.id AS flight_id, f.flight_number, f.origin, f.destination,
         f.departure_at, f.arrival_at, f.status AS flight_status, f.gate,
         o.city AS origin_city, o.name AS origin_name, o.timezone AS origin_timezone,
         d.city AS destination_city, d.name AS destination_name,
         CASE WHEN COALESCE(o.country, 'CO') <> 'CO' OR COALESCE(d.country, 'CO') <> 'CO'
              THEN 'international' ELSE 'domestic' END AS scope,
         ac.id AS aircraft_id, ac.name AS aircraft_name,
         ac.registration AS aircraft_registration, ac.family AS aircraft_family
  FROM public.flight_assignments a
  JOIN public.flights f ON f.id = a.flight_id
  JOIN public.aircraft ac ON ac.id = f.aircraft_id
  LEFT JOIN public.airports o ON o.code = f.origin
  LEFT JOIN public.airports d ON d.code = f.destination`;

// Arma el objeto en JS para que las fechas salgan en el mismo formato
// (ISO en UTC con Z) que el resto de la API.
function toAssignmentWithFlight(row) {
  return {
    id: row.id,
    role: row.role,
    slot_id: row.slot_id,
    status: row.status,
    source: row.source,
    created_at: row.created_at,
    is_replacement: row.is_replacement,
    replacement: row.is_replacement
      ? {
          reason: row.replacement_reason,
          approved_by: row.approved_by_name,
          approved_at: row.approved_at,
          deadline_at: row.deadline_at,
        }
      : null,
    acknowledged: row.is_replacement ? row.acknowledged_at !== null : null,
    acknowledged_at: row.acknowledged_at,
    flight: {
      id: row.flight_id,
      flight_number: row.flight_number,
      origin: row.origin,
      destination: row.destination,
      origin_city: row.origin_city,
      origin_name: row.origin_name,
      origin_timezone: row.origin_timezone,
      destination_city: row.destination_city,
      destination_name: row.destination_name,
      departure_at: row.departure_at,
      arrival_at: row.arrival_at,
      status: row.flight_status,
      gate: row.gate,
      scope: row.scope,
      block_minutes: Math.round((new Date(row.arrival_at) - new Date(row.departure_at)) / 60000),
    },
    aircraft: {
      id: row.aircraft_id,
      name: row.aircraft_name,
      registration: row.aircraft_registration,
      family: row.aircraft_family,
    },
  };
}

const assignmentColumns = `id, flight_id, crew_user_id, role, slot_id, status, source,
       rationale, is_replacement, replacement_reason, approved_by, approved_by_name,
       approved_at, deadline_at, acknowledged_at, created_at`;

function duplicateAssignmentError() {
  const error = new Error('El tripulante ya está asignado a este vuelo.');
  error.status = 409;
  return error;
}

async function createAssignment({ flightId, crewUserId, role }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.flight_assignments (flight_id, crew_user_id, role)
       VALUES ($1, $2, $3)
       RETURNING ${assignmentColumns}`,
      [flightId, crewUserId, role]
    );

    return rows[0];
  } catch (cause) {
    if (cause.code === '23505') {
      throw duplicateAssignmentError();
    }

    throw cause;
  }
}

async function findActiveAssignment(flightId, crewUserId) {
  const { rows } = await pool.query(
    `SELECT ${assignmentColumns}
     FROM public.flight_assignments
     WHERE flight_id = $1 AND crew_user_id = $2 AND status = 'assigned'`,
    [flightId, crewUserId]
  );

  return rows[0] || null;
}

// Marca la asignación vieja como `replaced` y crea la nueva en una sola
// transacción: o quedan los dos cambios, o no queda ninguno.
async function replaceAssignment({
  assignmentId,
  flightId,
  crewUserId,
  role,
  replacement = null,
}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const replaced = await client.query(
      `UPDATE public.flight_assignments
       SET status = 'replaced'
       WHERE id = $1 AND status = 'assigned'
       RETURNING ${assignmentColumns}`,
      [assignmentId]
    );

    if (!replaced.rows[0]) {
      const error = new Error('Esa asignación ya fue reemplazada.');
      error.status = 409;
      throw error;
    }

    // El reemplazo ocupa el mismo puesto. Si viene de una ausencia, se marca
    // como reemplazo con quién lo aprobó y el plazo para dar «Enterado».
    const created = await client.query(
      `INSERT INTO public.flight_assignments
         (flight_id, crew_user_id, role, slot_id, source, rationale, is_replacement,
          replacement_reason, approved_by, approved_by_name, approved_at, deadline_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${assignmentColumns}`,
      [
        flightId,
        crewUserId,
        role,
        replaced.rows[0].slot_id,
        replacement ? replacement.source : 'manual',
        replacement ? replacement.rationale : null,
        Boolean(replacement),
        replacement ? replacement.reason : null,
        replacement ? replacement.approvedBy : null,
        replacement ? replacement.approvedByName : null,
        replacement ? new Date().toISOString() : null,
        replacement ? replacement.deadlineAt : null,
      ]
    );

    await client.query('COMMIT');

    return { replaced: replaced.rows[0], assignment: created.rows[0] };
  } catch (cause) {
    await client.query('ROLLBACK');

    if (cause.code === '23505') {
      throw duplicateAssignmentError();
    }

    throw cause;
  } finally {
    client.release();
  }
}

// Asignaciones activas cuyos vuelos se cruzan con [from, to).
async function findAssignmentsInRange({ from, to }) {
  const { rows } = await pool.query(
    `${assignmentWithFlight}
     WHERE a.status = 'assigned'
       AND f.status NOT IN ('completed', 'cancelled')
       AND f.departure_at < $2
       AND f.arrival_at > $1
     ORDER BY f.departure_at`,
    [from, to]
  );

  return rows.map((row) => ({
    crew_user_id: row.crew_user_id,
    ...toAssignmentWithFlight(row),
  }));
}

// Vuelos activos del tripulante, para revisar que no se crucen.
async function findActiveFlightsByCrewUser(crewUserId) {
  const { rows } = await pool.query(
    `SELECT f.id, f.flight_number, f.departure_at, f.arrival_at
     FROM public.flight_assignments a
     JOIN public.flights f ON f.id = a.flight_id
     WHERE a.crew_user_id = $1
       AND a.status = 'assigned'
       AND f.status NOT IN ('completed', 'cancelled')`,
    [crewUserId]
  );

  return rows;
}

// Filtros opcionales: replacement (solo reemplazos) y acknowledged (con o sin «Enterado»).
async function findAssignmentsByCrewUser(crewUserId, { replacement = null, acknowledged = null } = {}) {
  const { rows } = await pool.query(
    `${assignmentWithFlight}
     WHERE a.crew_user_id = $1 AND a.status = 'assigned'
       AND ($2::boolean IS NULL OR a.is_replacement = $2)
       AND ($3::boolean IS NULL OR (a.acknowledged_at IS NOT NULL) = $3)
     ORDER BY f.departure_at`,
    [crewUserId, replacement, acknowledged]
  );

  return rows.map(toAssignmentWithFlight);
}

async function findNextAssignmentByCrewUser(crewUserId, now) {
  const { rows } = await pool.query(
    `${assignmentWithFlight}
     WHERE a.crew_user_id = $1
       AND a.status = 'assigned'
       AND f.status IN ('scheduled', 'delayed')
       AND f.departure_at > $2
     ORDER BY f.departure_at
     LIMIT 1`,
    [crewUserId, now]
  );

  return rows[0] ? toAssignmentWithFlight(rows[0]) : null;
}

// El reemplazo da «Enterado». Solo su propia asignación de reemplazo, una vez.
async function acknowledgeAssignment(id, crewUserId) {
  const { rows } = await pool.query(
    `UPDATE public.flight_assignments SET acknowledged_at = now()
     WHERE id = $1 AND crew_user_id = $2 AND status = 'assigned'
       AND is_replacement AND acknowledged_at IS NULL
     RETURNING ${assignmentColumns}`,
    [id, crewUserId]
  );

  return rows[0] || null;
}

async function findAssignmentById(id) {
  const { rows } = await pool.query(
    `SELECT ${assignmentColumns} FROM public.flight_assignments WHERE id = $1`,
    [id]
  );

  return rows[0] || null;
}

// Venció el plazo sin «Enterado»: se borra la asignación del reemplazo y la
// asignación que había reemplazado vuelve a quedar activa. En una transacción.
async function revertReplacement(flightId, crewUserId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: removed } = await client.query(
      `DELETE FROM public.flight_assignments
       WHERE flight_id = $1 AND crew_user_id = $2 AND status = 'assigned'
         AND is_replacement AND acknowledged_at IS NULL
       RETURNING ${assignmentColumns}`,
      [flightId, crewUserId]
    );

    if (!removed[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    const { rows: restored } = await client.query(
      `UPDATE public.flight_assignments SET status = 'assigned'
       WHERE id = (
         SELECT id FROM public.flight_assignments
         WHERE flight_id = $1 AND status = 'replaced'
           AND (slot_id IS NOT DISTINCT FROM $2) AND role = $3
         ORDER BY created_at DESC
         LIMIT 1
       )
       RETURNING ${assignmentColumns}`,
      [flightId, removed[0].slot_id, removed[0].role]
    );

    await client.query('COMMIT');
    return { removed: removed[0], restored: restored[0] || null };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Asignaciones activas de un vuelo (puestos ocupados).
async function findActiveByFlight(flightId) {
  const { rows } = await pool.query(
    `SELECT ${assignmentColumns} FROM public.flight_assignments
     WHERE flight_id = $1 AND status = 'assigned'
     ORDER BY created_at`,
    [flightId]
  );

  return rows;
}

async function insertSlotAssignment({ flightId, crewUserId, role, slotId, source, rationale }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.flight_assignments
         (flight_id, crew_user_id, role, slot_id, source, rationale)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${assignmentColumns}`,
      [flightId, crewUserId, role, slotId, source, rationale]
    );

    return rows[0];
  } catch (cause) {
    if (cause.code === '23505') {
      const error = new Error(
        cause.constraint === 'flight_assignments_active_slot_unique'
          ? 'El puesto ya está ocupado.'
          : 'El tripulante ya está en este vuelo.'
      );
      error.status = 409;
      error.code = cause.constraint === 'flight_assignments_active_slot_unique' ? 'slot_taken' : 'already_on_flight';
      throw error;
    }

    throw cause;
  }
}

// Quitar a alguien de un puesto (antes de confirmar la tripulación).
async function deleteSlotAssignment(flightId, slotId) {
  const { rows } = await pool.query(
    `DELETE FROM public.flight_assignments
     WHERE flight_id = $1 AND slot_id = $2 AND status = 'assigned' AND NOT is_replacement
     RETURNING ${assignmentColumns}`,
    [flightId, slotId]
  );

  return rows[0] || null;
}

module.exports = {
  findActiveByFlight,
  insertSlotAssignment,
  deleteSlotAssignment,
  acknowledgeAssignment,
  findAssignmentById,
  revertReplacement,
  createAssignment,
  findActiveAssignment,
  replaceAssignment,
  findAssignmentsInRange,
  findActiveFlightsByCrewUser,
  findAssignmentsByCrewUser,
  findNextAssignmentByCrewUser,
};

const { hubTimezone, localDate } = require('@vuelos/shared');
const { parseDayRange } = require('../../domain/entities/absence');

const time = (value) => new Date(value).getTime();

// Datos del vuelo copiados en la ausencia al reportarla (sin llamar a Flights).
function flightFields(row) {
  return {
    flight_id: row.flight_id,
    flight_number: row.flight_number,
    origin: row.flight_origin,
    destination: row.flight_destination,
    departure_at: row.flight_departure_at,
    slot_role: row.slot_role,
  };
}

// Lista blanca: nada del reemplazo, de quién aprobó ni de los plazos.
function toFlight(row) {
  return { id: row.id, code: row.code, ...flightFields(row), status: row.status };
}

function toAbsence(row, flights) {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    reason: row.reason,
    notes: row.notes,
    status: row.status,
    start_date: row.start_date,
    end_date: row.end_date,
    ...flightFields(row),
    attachment: row.attachment || null,
    created_at: row.created_at,
    flights,
  };
}

// ?from=&to=: las de fechas que se cruzan con el rango y las de un vuelo cuyo día
// de salida (en la zona de la base del tripulante) cae dentro.
function inRange(absence, { from, to }, zone) {
  const [start, end] =
    absence.kind === 'dates'
      ? [absence.start_date, absence.end_date]
      : [localDate(absence.departure_at, zone), localDate(absence.departure_at, zone)];
  return (!from || end >= from) && (!to || start <= to);
}

// Ausencias del tripulante que inició sesión (GET /absences/me), la más reciente
// primero. Cada ausencia por fechas lleva en flights las de sus vuelos
// (parent_absence_id), por salida; las de un vuelo reportado directamente salen
// solas, con flights vacío.
function createGetMyAbsences({ absenceRepository, findCrewMemberByUserId }) {
  return async function getMyAbsences(user, query = {}) {
    const range = parseDayRange(query);
    const filtered = Boolean(range.from || range.to);
    const [rows, member] = await Promise.all([
      absenceRepository.findCrewAbsences(user.id),
      filtered ? findCrewMemberByUserId(user.id) : null,
    ]);

    const ids = new Set(rows.map((row) => row.id));
    const children = new Map();
    for (const row of rows) {
      if (row.parent_absence_id && ids.has(row.parent_absence_id)) {
        const list = children.get(row.parent_absence_id) || [];
        list.push(row);
        children.set(row.parent_absence_id, list);
      }
    }

    const absences = rows
      .filter((row) => !(row.parent_absence_id && ids.has(row.parent_absence_id)))
      .map((row) =>
        toAbsence(
          row,
          (children.get(row.id) || [])
            .toSorted((a, b) => time(a.flight_departure_at) - time(b.flight_departure_at))
            .map(toFlight)
        )
      )
      .toSorted((a, b) => time(b.created_at) - time(a.created_at));

    if (!filtered) return absences;
    const zone = hubTimezone(member && member.base);
    return absences.filter((absence) => inRange(absence, range, zone));
  };
}

module.exports = createGetMyAbsences;

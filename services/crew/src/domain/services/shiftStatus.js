// Estado de cada tripulante en el turno y del turno mismo. Funciones puras:
// reciben los datos y la hora actual, y no consultan nada.
const HOUR = 3600000;
const MIN_REST_HOURS = 10;
const SCHEDULED_WINDOW_HOURS = 12;
const REPORT_BEFORE_MINUTES = 90;
const MEDICAL_WARNING_DAYS = 30;

// Turno según la hora de Colombia: mañana 06–14, tarde 14–22, noche 22–06.
function currentShift(now = Date.now()) {
  const hour = new Date(now - 5 * HOUR).getUTCHours();
  if (hour >= 6 && hour < 14) return 'morning';
  if (hour >= 14 && hour < 22) return 'afternoon';
  return 'night';
}

function daysUntil(date, now) {
  return Math.ceil((new Date(`${date}T23:59:59Z`).getTime() - now) / (24 * HOUR));
}

function flightSummary(flight) {
  return { id: flight.id, flight_number: flight.flight_number, origin: flight.origin, destination: flight.destination };
}

const ABSENT_STATUSES = { medical_leave: 'incapacidad médica', vacation: 'vacaciones' };

// standby (guardia) · in_flight · scheduled (sale en las próximas 12 h) ·
// rest (aterrizó hace menos de 10 h) · absent · available (libre).
function crewMemberShiftState(member, assignments, openAbsence, now = Date.now()) {
  const flights = assignments.map((item) => item.flight);
  const time = (value) => new Date(value).getTime();

  const medical = member.medical_expires_on ? daysUntil(member.medical_expires_on, now) : null;
  const base = {
    id: member.user_id,
    employee_code: member.employee_code,
    full_name: member.name || null,
    position: member.position,
    rank: member.rank,
    base: member.base_code,
    phone: member.phone,
    radio_channel: member.radio_channel,
    expiring_certification:
      medical !== null && medical <= MEDICAL_WARNING_DAYS
        ? { name: 'Certificado médico', days_left: medical }
        : null,
  };

  if (openAbsence) {
    return { ...base, status: 'absent', reason: openAbsence.reason, flight: { id: openAbsence.flight_id, flight_number: openAbsence.flight_number, origin: openAbsence.flight_origin, destination: openAbsence.flight_destination } };
  }
  if (ABSENT_STATUSES[member.status] || !member.is_active) {
    return { ...base, status: 'absent', reason: ABSENT_STATUSES[member.status] || 'inactivo', flight: null };
  }

  const flying = flights.find((flight) => time(flight.departure_at) <= now && now < time(flight.arrival_at));
  if (flying || member.status === 'in_flight') {
    return { ...base, status: 'in_flight', flight: flying ? flightSummary(flying) : null, arrival_at: flying ? flying.arrival_at : null };
  }

  if (member.status === 'on_duty') {
    return {
      ...base,
      status: 'standby',
      location: member.standby_location,
      minutes_to_ramp: member.minutes_to_ramp,
      guard_until: member.standby_until,
      replacement_blocker: medical !== null && medical < 0 ? 'Certificado médico vencido.' : null,
    };
  }

  const next = flights
    .filter((flight) => time(flight.departure_at) > now && time(flight.departure_at) <= now + SCHEDULED_WINDOW_HOURS * HOUR)
    .sort((a, b) => time(a.departure_at) - time(b.departure_at))[0];
  if (next) {
    return {
      ...base,
      status: 'scheduled',
      flight: flightSummary(next),
      report_at: new Date(time(next.departure_at) - REPORT_BEFORE_MINUTES * 60000).toISOString(),
    };
  }

  const last = flights
    .filter((flight) => time(flight.arrival_at) <= now)
    .sort((a, b) => time(b.arrival_at) - time(a.arrival_at))[0];
  if (last && now < time(last.arrival_at) + MIN_REST_HOURS * HOUR) {
    return { ...base, status: 'rest', rest_until: new Date(time(last.arrival_at) + MIN_REST_HOURS * HOUR).toISOString() };
  }

  return { ...base, status: 'available' };
}

// Orden de la pantalla: guardia (por minutos a rampa), en vuelo (por llegada),
// programados (por presentación), descanso (por fin), ausentes y libres.
function shiftOrder(a, b) {
  const groups = { standby: 0, in_flight: 1, scheduled: 2, rest: 3, absent: 4, available: 5 };
  const time = (value) => (value ? new Date(value).getTime() : Infinity);
  return (
    groups[a.status] - groups[b.status] ||
    (a.status === 'standby' ? (a.minutes_to_ramp ?? 999) - (b.minutes_to_ramp ?? 999) : 0) ||
    (a.status === 'in_flight' ? time(a.arrival_at) - time(b.arrival_at) : 0) ||
    (a.status === 'scheduled' ? time(a.report_at) - time(b.report_at) : 0) ||
    (a.status === 'rest' ? time(a.rest_until) - time(b.rest_until) : 0) ||
    String(a.employee_code).localeCompare(String(b.employee_code))
  );
}

module.exports = { currentShift, crewMemberShiftState, shiftOrder, MIN_REST_HOURS };

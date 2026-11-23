const { MAX_MONTH_FLIGHT_HOURS, hubTimezone, localDate } = require('@vuelos/shared');
const { qualificationRule } = require('./qualificationRule');
const {
  durationHours,
  overlaps,
  monthHours,
  restHoursBefore,
} = require('../services/flightTime');

// Las 8 reglas de elegibilidad, en el orden en que se revisan. Se aplican
// SIEMPRE en código, con o sin IA: a Claude solo le llegan tripulantes que
// ya las cumplen. Cada regla devuelve null si cumple, o el motivo si no.
// El dato que falta (habilitaciones o inglés sin registrar, p. ej. en un tripulante
// recién creado) no bloquea: queda como advertencia (warningsFor) y ese candidato va
// detrás de los que tienen los datos. El dato que existe y no cumple sí bloquea.
// El certificado médico se descartó: no es regla (spec tripulantes-nuevos-programacion).
//
// Contexto de cada regla: { member, flight, role, memberAssignments }
// - flight trae aircraft_family y scope (domestic / international).
// - memberAssignments son los vuelos activos del tripulante cerca de la fecha.

const MIN_REST_HOURS = 10;
// 14 CFR 117.23: el mismo tope que muestra Mis Vuelos (crew).
const MAX_MONTH_HOURS = MAX_MONTH_FLIGHT_HOURS;
const MIN_INTERNATIONAL_ENGLISH = 4;
const PILOT_RANKS = ['captain', 'first_officer'];
const AVAILABLE_STATUSES = ['available', 'on_duty'];

const STATUS_LABELS = {
  in_flight: 'está en vuelo',
  medical_leave: 'tiene incapacidad médica',
  vacation: 'está de vacaciones',
};

// 1. Tiene el rango del puesto.
const rankRule = qualificationRule;

// 2. Habilitado en la familia del avión.
const ratingRule = {
  name: 'rating',
  check({ member, flight }) {
    const family = flight.aircraft_family;
    const ratings = member.ratings || [];
    if (!family || ratings.length === 0) return null;
    return ratings.includes(family)
      ? null
      : `No está habilitado en ${family}.`;
  },
};

// 6. No está ausente, incapacitado ni de vacaciones (y su cuenta está activa).
const availabilityRule = {
  name: 'availability',
  check({ member }) {
    if (!member.is_active) return 'Está inactivo.';
    if (!AVAILABLE_STATUSES.includes(member.status)) {
      return `No está disponible: ${STATUS_LABELS[member.status] || member.status}.`;
    }
    return null;
  },
};

// No tiene una ausencia reportada (no cancelada) para este vuelo ni en sus fechas.
// Crew manda en `absences` las vigentes de cada tripulante; las fechas son días locales
// de su base, así que el vuelo se mira en esa zona. Después de la ausencia, sí puede.
const absenceRule = {
  name: 'absence',
  check({ member, flight }) {
    const absences = member.absences || [];
    if (absences.some((item) => item.flight_id && item.flight_id === flight.id)) {
      return 'Tiene una ausencia reportada para este vuelo.';
    }
    const zone = hubTimezone(member.base_code);
    const first = localDate(flight.departure_at, zone);
    const last = localDate(flight.arrival_at, zone);
    const hit = absences.find(
      (item) => item.start_date && item.end_date && item.start_date <= last && item.end_date >= first
    );
    return hit ? `Está ausente del ${hit.start_date} al ${hit.end_date}.` : null;
  },
};

// 7. No tiene otro vuelo que se cruce en horario (ni está ya en este vuelo).
const overlapRule = {
  name: 'overlap',
  check({ flight, memberAssignments }) {
    if (memberAssignments.some((item) => item.flight.id === flight.id)) {
      return 'Ya está asignado a este vuelo.';
    }
    const conflict = memberAssignments.find((item) => overlaps(item.flight, flight));
    return conflict
      ? `Ya asignado a ${conflict.flight.flight_number}, que se cruza en horario.`
      : null;
  },
};

// 4. Descanso mínimo de 10 h antes y después del vuelo.
const restRule = {
  name: 'rest',
  check({ flight, memberAssignments }) {
    const margin = MIN_REST_HOURS * 60 * 60 * 1000;
    const start = new Date(flight.departure_at).getTime() - margin;
    const end = new Date(flight.arrival_at).getTime() + margin;
    const conflict = memberAssignments.find(
      ({ flight: other }) =>
        other.id !== flight.id &&
        new Date(other.departure_at).getTime() < end &&
        new Date(other.arrival_at).getTime() > start
    );
    return conflict
      ? `No cumple ${MIN_REST_HOURS} h de descanso por el vuelo ${conflict.flight.flight_number}.`
      : null;
  },
};

// 5. No supera 100 h de vuelo en el mes (local de su base) contando este vuelo.
const monthHoursRule = {
  name: 'month_hours',
  check({ member, flight, memberAssignments }) {
    const total = monthHours(flight, memberAssignments, member.base_code) + durationHours(flight);
    return total > MAX_MONTH_HOURS
      ? `Superaría ${MAX_MONTH_HOURS} h de vuelo en el mes (${Math.round(total)} h).`
      : null;
  },
};

function needsEnglish({ member, flight }) {
  return flight.scope === 'international' && PILOT_RANKS.includes(member.rank);
}

// 8. Pilotos en vuelo internacional: inglés OACI nivel 4 o más (sin registro: advertencia).
const englishRule = {
  name: 'english',
  check({ member, flight }) {
    if (!needsEnglish({ member, flight }) || member.english_level == null) return null;
    return member.english_level >= MIN_INTERNATIONAL_ENGLISH
      ? null
      : `Inglés OACI ${member.english_level}; se requiere ${MIN_INTERNATIONAL_ENGLISH} para vuelos internacionales.`;
  },
};

const ELIGIBILITY_RULES = [
  rankRule,
  ratingRule,
  availabilityRule,
  absenceRule,
  overlapRule,
  restRule,
  monthHoursRule,
  englishRule,
];

// El primer motivo por el que no puede volar, o null si cumple todas.
function firstFailure(context) {
  for (const rule of ELIGIBILITY_RULES) {
    const reason = rule.check(context);
    if (reason) return reason;
  }
  return null;
}

// Datos sin registrar de un candidato que cumple las reglas: no lo bloquean, pero se
// le avisan al supervisor y a la IA, y ese candidato va detrás de los demás.
function warningsFor({ member, flight }) {
  const warnings = [];
  if (flight.aircraft_family && (member.ratings || []).length === 0) {
    warnings.push(`Sin habilitación registrada en ${flight.aircraft_family}`);
  }
  if (needsEnglish({ member, flight }) && member.english_level == null) {
    warnings.push('Sin nivel de inglés OACI registrado');
  }
  return warnings;
}

module.exports = {
  ELIGIBILITY_RULES,
  firstFailure,
  warningsFor,
  MIN_REST_HOURS,
  MAX_MONTH_HOURS,
  restHoursBefore,
};

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
//
// Contexto de cada regla: { member, flight, role, memberAssignments }
// - flight trae aircraft_family y scope (domestic / international).
// - memberAssignments son los vuelos activos del tripulante cerca de la fecha.

const MIN_REST_HOURS = 10;
const MAX_MONTH_HOURS = 90;
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
    if (!family) return null;
    return (member.ratings || []).includes(family)
      ? null
      : `No está habilitado en ${family}.`;
  },
};

// 3. Certificado médico vigente el día del vuelo.
const medicalRule = {
  name: 'medical',
  check({ member, flight }) {
    const flightDay = new Date(flight.departure_at).toISOString().slice(0, 10);
    if (!member.medical_expires_on) return 'No tiene certificado médico registrado.';
    return member.medical_expires_on >= flightDay
      ? null
      : `Certificado médico vencido el ${member.medical_expires_on}.`;
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

// 5. No supera 90 h de vuelo en el mes contando este vuelo.
const monthHoursRule = {
  name: 'month_hours',
  check({ flight, memberAssignments }) {
    const total = monthHours(flight, memberAssignments) + durationHours(flight);
    return total > MAX_MONTH_HOURS
      ? `Superaría ${MAX_MONTH_HOURS} h de vuelo en el mes (${Math.round(total)} h).`
      : null;
  },
};

// 8. Pilotos en vuelo internacional: inglés OACI nivel 4 o más.
const englishRule = {
  name: 'english',
  check({ member, flight }) {
    if (flight.scope !== 'international' || !PILOT_RANKS.includes(member.rank)) return null;
    return (member.english_level || 0) >= MIN_INTERNATIONAL_ENGLISH
      ? null
      : `Inglés OACI ${member.english_level || 'sin registro'}; se requiere ${MIN_INTERNATIONAL_ENGLISH} para vuelos internacionales.`;
  },
};

const ELIGIBILITY_RULES = [
  rankRule,
  ratingRule,
  medicalRule,
  availabilityRule,
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

module.exports = {
  ELIGIBILITY_RULES,
  firstFailure,
  MIN_REST_HOURS,
  MAX_MONTH_HOURS,
  restHoursBefore,
};

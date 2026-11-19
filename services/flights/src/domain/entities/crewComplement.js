// Puestos que debe tener la tripulación de un vuelo:
// - Capitán y Primer Oficial, siempre.
// - Piloto de relevo si el vuelo dura más de 8 horas (capitán o primer oficial).
// - Jefe de Cabina + 1 TCP (auxiliar) por cada 50 sillas, contando al Jefe de Cabina.
const RELIEF_PILOT_AFTER_HOURS = 8;
const SEATS_PER_CABIN_CREW = 50;

function durationHours(flight) {
  return (new Date(flight.arrival_at) - new Date(flight.departure_at)) / 3600000;
}

function requiredSlots(flight) {
  const slots = [
    { id: 'captain', role: 'captain', accepts: ['captain'], label: 'Capitán' },
    { id: 'first_officer', role: 'first_officer', accepts: ['first_officer'], label: 'Primer Oficial' },
  ];

  if (durationHours(flight) > RELIEF_PILOT_AFTER_HOURS) {
    slots.push({
      id: 'relief',
      role: 'relief',
      accepts: ['captain', 'first_officer'],
      label: 'Piloto de relevo',
    });
  }

  const cabin = Math.max(1, Math.ceil((flight.aircraft_seats || 0) / SEATS_PER_CABIN_CREW));
  slots.push({ id: 'purser', role: 'purser', accepts: ['purser'], label: 'Jefe de Cabina' });
  for (let index = 1; index < cabin; index += 1) {
    slots.push({
      id: `fa-${index}`,
      role: 'flight_attendant',
      accepts: ['flight_attendant'],
      label: `TCP ${index}`,
    });
  }

  return slots;
}

// unassigned: nadie asignado · incomplete: faltan puestos · complete: todos
// los puestos ocupados · confirmed: el supervisor confirmó la tripulación.
function crewStatus(flight, assignments) {
  if (flight.crew_confirmed_at) return 'confirmed';

  const slots = requiredSlots(flight);
  const filled = slots.filter((slot) =>
    assignments.some((item) => item.slot_id === slot.id && item.status === 'assigned')
  ).length;

  if (filled === 0) return 'unassigned';
  return filled === slots.length ? 'complete' : 'incomplete';
}

module.exports = { requiredSlots, crewStatus, RELIEF_PILOT_AFTER_HOURS };

// Disponibilidad: el tripulante debe estar activo, en estado `available`
// y no estar ya asignado al vuelo.
const availabilityRule = {
  name: 'availability',

  // Devuelve null si cumple, o el motivo por el que se descarta.
  check({ member, flight, memberAssignments }) {
    if (!member.is_active) {
      return 'Está inactivo.';
    }

    if (member.status !== 'available') {
      return `No está disponible (estado: ${member.status}).`;
    }

    if (memberAssignments.some((item) => item.flight.id === flight.id)) {
      return 'Ya está asignado a este vuelo.';
    }

    return null;
  },
};

module.exports = { availabilityRule };

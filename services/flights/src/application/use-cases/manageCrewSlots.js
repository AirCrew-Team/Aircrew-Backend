const { requiredSlots, crewStatus } = require('../../domain/entities/crewComplement');
const { isValidFlightId } = require('../../domain/entities/flight');
const { canAssignCrewTo } = require('../../domain/entities/assignment');
const { DomainError } = require('../../domain/errors');

const SOURCES = ['manual', 'ai', 'rule'];

// Programación: ocupar, liberar y confirmar los puestos de un vuelo.
// Son endpoints internos: Recommendation valida antes las 8 reglas.
function createManageCrewSlots({ flightRepository, assignmentRepository }) {
  async function editableFlight(flightId) {
    const flight = isValidFlightId(flightId) ? await flightRepository.findFlightById(flightId) : null;
    if (!flight) throw new DomainError('Vuelo no encontrado.', 404);
    if (flight.crew_confirmed_at) {
      throw new DomainError('La tripulación de este vuelo ya está confirmada.', 409, { code: 'crew_confirmed' });
    }
    if (!canAssignCrewTo(flight)) {
      throw new DomainError('Solo se programan vuelos programados o demorados.', 409, { code: 'flight_closed' });
    }
    return flight;
  }

  function findSlot(flight, slotId) {
    const slot = requiredSlots(flight).find((item) => item.id === slotId);
    if (!slot) throw new DomainError('Ese puesto no existe en este vuelo.', 404, { code: 'slot_not_found' });
    return slot;
  }

  async function assignSlot(flightId, slotId, input) {
    const { crew_user_id: crewUserId, rank, source = 'manual', rationale = null } = input || {};
    if (!isValidFlightId(crewUserId)) {
      throw new DomainError('Se requiere un crew_user_id válido.', 400, { field: 'crew_user_id' });
    }

    const flight = await editableFlight(flightId);
    const slot = findSlot(flight, slotId);
    if (!slot.accepts.includes(rank)) {
      throw new DomainError(`El puesto ${slot.label} requiere ${slot.accepts.join(' o ')}.`, 409, {
        code: 'rank_mismatch',
      });
    }

    return assignmentRepository.insertSlotAssignment({
      flightId: flight.id,
      crewUserId,
      role: slot.role === 'relief' ? rank : slot.role,
      slotId: slot.id,
      source: SOURCES.includes(source) ? source : 'manual',
      rationale: typeof rationale === 'string' ? rationale : null,
    });
  }

  async function removeSlot(flightId, slotId) {
    const flight = await editableFlight(flightId);
    findSlot(flight, slotId);
    const removed = await assignmentRepository.deleteSlotAssignment(flight.id, slotId);
    if (!removed) throw new DomainError('Ese puesto no tiene a nadie asignado.', 404, { code: 'slot_empty' });
    return removed;
  }

  async function confirmCrew(flightId, user) {
    const flight = await editableFlight(flightId);
    const assignments = await assignmentRepository.findActiveByFlight(flight.id);
    if (crewStatus(flight, assignments) !== 'complete') {
      throw new DomainError('La tripulación no está completa.', 409, { code: 'crew_incomplete' });
    }
    await flightRepository.confirmFlightCrew(flight.id, user.role === 'service' ? null : user.id);
    return { flight_id: flight.id, crew: assignments.map((item) => item.crew_user_id) };
  }

  // El vuelo con sus puestos y quién ocupa cada uno (sin nombres: los agrega Recommendation).
  async function getCrewPlan(flightId) {
    const flight = isValidFlightId(flightId) ? await flightRepository.findFlightById(flightId) : null;
    if (!flight) throw new DomainError('Vuelo no encontrado.', 404);
    const assignments = await assignmentRepository.findActiveByFlight(flight.id);
    return {
      ...flight,
      required_slots: requiredSlots(flight),
      crew_status: crewStatus(flight, assignments),
      assignments,
    };
  }

  return { assignSlot, removeSlot, confirmCrew, getCrewPlan };
}

module.exports = createManageCrewSlots;

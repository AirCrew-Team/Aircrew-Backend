const { isValidFlightId } = require('../../domain/entities/flight');
const { DomainError } = require('../../domain/errors');

// Interno: venció el plazo sin «Enterado». Se quita al reemplazo del vuelo y
// el puesto vuelve a quedar como antes, para proponer al siguiente candidato.
function createRevertReplacement(assignmentRepository) {
  return async function revertReplacement(flightId, input) {
    const { crew_user_id: crewUserId } = input || {};

    if (!isValidFlightId(flightId) || !isValidFlightId(crewUserId)) {
      throw new DomainError('Se requieren un vuelo y un crew_user_id válidos.');
    }

    const result = await assignmentRepository.revertReplacement(flightId, crewUserId);

    if (!result) {
      throw new DomainError(
        'No hay un reemplazo sin confirmar de ese tripulante en el vuelo.',
        409,
        { code: 'nothing_to_revert' }
      );
    }

    return result;
  };
}

module.exports = createRevertReplacement;

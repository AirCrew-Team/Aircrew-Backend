const {
  isValidAbsenceId,
  validateSuggestionsUpdate,
} = require('../../domain/entities/absence');
const { DomainError } = require('../../domain/errors');

// Recommendation avisa que terminó de buscar reemplazos: se guarda el estado
// y se registra en la línea de tiempo.
function createUpdateSuggestionsState(absenceRepository) {
  return async function updateSuggestionsState(id, input) {
    const { state, candidateCount } = validateSuggestionsUpdate(input);

    const updated = isValidAbsenceId(id)
      ? await absenceRepository.updateSuggestionsState(id, state)
      : null;

    if (!updated) {
      throw new DomainError('Ausencia no encontrada.', 404);
    }

    if (state === 'ready') {
      await absenceRepository.addAbsenceEvent(
        id,
        'ai_ready',
        candidateCount === 1
          ? 'Se propuso 1 candidato'
          : `Se propusieron ${candidateCount} candidatos`
      );
    } else if (state === 'none') {
      await absenceRepository.addAbsenceEvent(
        id,
        'ai_none',
        'Nadie cumple las reglas para cubrir el puesto'
      );
    }

    return updated;
  };
}

module.exports = createUpdateSuggestionsState;

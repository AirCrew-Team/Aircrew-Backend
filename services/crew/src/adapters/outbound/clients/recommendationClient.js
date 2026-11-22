const { recommendationServiceUrl } = require('../../../config/env');
const { serviceAuthorization } = require('./serviceToken');

// Le pide a Recommendation que busque reemplazos para una ausencia. No se
// espera la respuesta: la IA corre en segundo plano y avisa por SSE cuando
// termina. Si falla, la ausencia queda en la cola y el supervisor puede pedir
// otra ronda con /regenerate.
async function requestSuggestions(absenceId) {
  try {
    const response = await fetch(
      `${recommendationServiceUrl}/absences/${encodeURIComponent(absenceId)}/suggest`,
      {
        method: 'POST',
        headers: { Authorization: serviceAuthorization() },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) {
      console.error(`Recommendation no aceptó la búsqueda: HTTP ${response.status}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`No se pudo pedir la búsqueda de reemplazos: ${error.message}`);
    return false;
  }
}

module.exports = { requestSuggestions };

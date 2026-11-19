const { crewServiceUrl } = require('../../../config/env');
const { serviceAuthorization } = require('./serviceToken');

// Avisa a Crew que el reemplazo dio «Enterado» para que la ausencia quede
// cubierta. Si falla, solo se registra: la revisión de plazos de
// Recommendation lo detecta después y la cubre igual.
async function markAbsenceAcknowledged({ flightId, replacementUserId }) {
  try {
    const response = await fetch(`${crewServiceUrl}/absences/acknowledged`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: serviceAuthorization() },
      body: JSON.stringify({ flight_id: flightId, replacement_user_id: replacementUserId }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`Crew no marcó la ausencia como cubierta: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`No se pudo avisar a Crew del «Enterado»: ${error.message}`);
  }
}

module.exports = { markAbsenceAcknowledged };

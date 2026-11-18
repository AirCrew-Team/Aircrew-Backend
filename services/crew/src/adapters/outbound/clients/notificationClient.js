const { notificationServiceUrl } = require('../../../config/env');

// Avisa a Notification que hay una ausencia nueva, con el token del tripulante.
// Es un extra: si falla, solo se registra y la ausencia queda guardada igual.
async function notifyAbsenceReported(absence, authorization) {
  try {
    const response = await fetch(`${notificationServiceUrl}/events/absence-reported`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({ absence }),
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      console.error(`No se pudo enviar la alerta de ausencia: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`No se pudo enviar la alerta de ausencia: ${error.message}`);
  }
}

module.exports = { notifyAbsenceReported };

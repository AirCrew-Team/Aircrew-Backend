const { notificationServiceUrl } = require('../../../config/env');
const { serviceAuthorization } = require('./serviceToken');

// Avisos a Notification. Son un extra: si fallan, solo se registran y el flujo sigue.
async function post(path, body, authorization, label) {
  try {
    const response = await fetch(`${notificationServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      console.error(`No se pudo enviar la alerta de ${label}: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`No se pudo enviar la alerta de ${label}: ${error.message}`);
  }
}

// Ausencia nueva, con el token del tripulante que la reportó.
function notifyAbsenceReported(absence, authorization) {
  return post('/events/absence-reported', { absence }, authorization, 'ausencia');
}

// La ausencia quedó cubierta (el reemplazo dio «Enterado»). Token de servicio.
function notifyAbsenceCovered(absence) {
  return post('/events/absence-covered', { absence }, serviceAuthorization(), 'ausencia cubierta');
}

module.exports = { notifyAbsenceReported, notifyAbsenceCovered };

const { notificationServiceUrl } = require('../../../config/env');

// Avisa a Notification que una ausencia ya tiene reemplazo, con el token del
// supervisor. Es un extra: si falla, solo se registra.
async function notifyAbsenceCovered(absence, authorization) {
  try {
    const response = await fetch(`${notificationServiceUrl}/events/absence-covered`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({ absence }),
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      console.error(`No se pudo enviar la alerta de reemplazo: HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`No se pudo enviar la alerta de reemplazo: ${error.message}`);
  }
}

module.exports = { notifyAbsenceCovered };

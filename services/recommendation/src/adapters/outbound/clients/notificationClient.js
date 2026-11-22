const { notificationServiceUrl } = require('../../../config/env');

// Avisos a Notification. Son un extra: si fallan, solo se registran.
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

// Una ausencia ya tiene reemplazo (token del supervisor que confirmó).
function notifyAbsenceCovered(absence, authorization) {
  return post('/events/absence-covered', { absence }, authorization, 'reemplazo');
}

// Terminó la búsqueda de candidatos (token de servicio).
function notifySuggestionsReady(payload, authorization) {
  return post('/events/suggestions-ready', payload, authorization, 'candidatos listos');
}

// Al tripulante elegido: lo asignaron como reemplazo (token del supervisor).
function notifyAssignmentReplacement(payload, authorization) {
  return post('/events/assignment-replacement', payload, authorization, 'reemplazo asignado');
}

// A los supervisores: el reemplazo no confirmó a tiempo (token de servicio).
function notifyDeadlineMissed(payload, authorization) {
  return post('/events/deadline-missed', payload, authorization, 'plazo vencido');
}

module.exports = {
  notifyAbsenceCovered,
  notifySuggestionsReady,
  notifyAssignmentReplacement,
  notifyDeadlineMissed,
};

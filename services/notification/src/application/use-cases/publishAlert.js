const { SUPERVISOR_AUDIENCE } = require('../../domain/alerts');

// Arma la alerta con la regla del dominio, la guarda una vez para el rol supervisor
// (así la ve en la campana aunque no estuviera conectado) y la entrega en vivo
// a los supervisores conectados por el publicador que se inyecte (hoy, SSE).
// El publicador cumple: publishToSupervisors(alert) -> número de conexiones.
// `fromInput` dice qué parte del body recibe la regla (por defecto, absence).
// Si guardar falla, la alerta se entrega en vivo igual y el error queda en el log.
function createPublishAlert({
  buildAlert,
  publisher,
  notificationRepository = null,
  fromInput = (input) => input && input.absence,
}) {
  return async function publishAlert(input) {
    const alert = buildAlert(fromInput(input));
    const { type, message, sent_at: _sentAt, ...data } = alert;
    let saved = null;

    if (notificationRepository) {
      try {
        saved = await notificationRepository.insertNotification({
          audienceRole: SUPERVISOR_AUDIENCE,
          type,
          message,
          data,
        });
      } catch (error) {
        console.error(`No se pudo guardar la alerta ${type} de supervisores: ${error.message}`);
      }
    }

    const live = saved ? { ...alert, id: saved.id, sent_at: saved.created_at } : alert;
    const deliveredTo = publisher.publishToSupervisors(live);

    return { type, message, delivered_to: deliveredTo, saved: Boolean(saved) };
  };
}

module.exports = createPublishAlert;

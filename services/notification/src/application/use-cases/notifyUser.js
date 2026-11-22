// Aviso para una persona: se guarda en su historial (campana) y se entrega en vivo
// a sus conexiones abiertas. Si no está conectada, lo verá en la campana al entrar.
// Si guardar falla, el aviso se entrega en vivo igual y el error queda en el log.
function createNotifyUser({ notificationRepository, publisher }) {
  return async function notifyUser(userId, alert) {
    const { type, message, sent_at: _sentAt, ...data } = alert;
    let saved = null;

    try {
      saved = await notificationRepository.insertNotification({ userId, type, message, data });
    } catch (error) {
      console.error(`No se pudo guardar el aviso ${type} de ${userId}: ${error.message}`);
    }

    const live = saved
      ? { ...alert, id: saved.id, sent_at: saved.created_at }
      : alert;
    const deliveredTo = publisher.publishToUser(userId, live);

    return { type, message, delivered_to: deliveredTo, saved: Boolean(saved) };
  };
}

module.exports = createNotifyUser;

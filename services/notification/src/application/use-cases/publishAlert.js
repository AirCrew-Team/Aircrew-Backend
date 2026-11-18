// Arma la alerta con la regla del dominio y la entrega a los supervisores
// por el publicador que se inyecte (hoy, Socket.IO).
// El publicador cumple: publishToSupervisors(alert) -> número de conexiones.
function createPublishAlert({ buildAlert, publisher }) {
  return function publishAlert(input) {
    const alert = buildAlert(input && input.absence);
    const deliveredTo = publisher.publishToSupervisors(alert);

    return { type: alert.type, message: alert.message, delivered_to: deliveredTo };
  };
}

module.exports = createPublishAlert;

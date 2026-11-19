// Arma la alerta con la regla del dominio y la entrega a los supervisores
// por el publicador que se inyecte (hoy, Socket.IO).
// El publicador cumple: publishToSupervisors(alert) -> número de conexiones.
// `fromInput` dice qué parte del body recibe la regla (por defecto, absence).
function createPublishAlert({ buildAlert, publisher, fromInput = (input) => input && input.absence }) {
  return function publishAlert(input) {
    const alert = buildAlert(fromInput(input));
    const deliveredTo = publisher.publishToSupervisors(alert);

    return { type: alert.type, message: alert.message, delivered_to: deliveredTo };
  };
}

module.exports = createPublishAlert;

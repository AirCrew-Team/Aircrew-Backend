const { INotificador } = require('../../../application/ports/outbound/INotificador');

class NotificadorConsola extends INotificador {
  async enviar(/* destino, mensaje */) {
    // TODO: escribir la notificación en consola (canal temporal)
  }
}

module.exports = { NotificadorConsola };

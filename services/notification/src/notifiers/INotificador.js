class INotificador {
  async enviar(/* destino, mensaje */) {
    throw new Error('enviar() debe implementarse en cada notificador');
  }
}

module.exports = { INotificador };

class BusRabbitMQ {
  constructor(url) {
    this.url = url;
  }

  async conectar() {
    throw new Error('La conexión con RabbitMQ está pendiente de implementar');
  }

  async publicar() {
    throw new Error('La publicación de eventos está pendiente de implementar');
  }

  async suscribir() {
    throw new Error('La suscripción a eventos está pendiente de implementar');
  }
}

module.exports = { BusRabbitMQ };

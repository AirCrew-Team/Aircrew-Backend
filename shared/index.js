const { BusRabbitMQ } = require('./events/BusRabbitMQ');
const { crearSobreEvento } = require('./events/sobreEvento');
const { errorHandler } = require('./middlewares/errorHandler');

function registrar(mensaje) {
  console.log(mensaje);
}

module.exports = {
  BusRabbitMQ,
  crearSobreEvento,
  errorHandler,
  registrar,
};

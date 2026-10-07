const { puerto, nombreServicio } = require('./config/env');
const { registrar } = require('@vuelos/shared');
const app = require('./app');

app.listen(puerto, () => {
  registrar(`${nombreServicio} escuchando en el puerto ${puerto}`);
});

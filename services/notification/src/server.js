const { puerto, nombreServicio } = require('./config/env');
const app = require('./app');

app.listen(puerto, () => {
  console.log(`${nombreServicio} corriendo en el puerto ${puerto}`);
});

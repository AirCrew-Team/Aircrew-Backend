const { port, nameService } = require('./config/env');
const app = require('./app');

app.listen(port, () => {
  console.log(`${nameService} corriendo en el puerto ${port}`);
});
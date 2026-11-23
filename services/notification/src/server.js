const { port, nameService } = require('./config/env');
const app = require('./app');

// HTTP normal: los avisos en vivo van por SSE (GET /stream), en el mismo puerto.
app.listen(port, () => {
  console.log(`${nameService} corriendo en el puerto ${port}`);
});

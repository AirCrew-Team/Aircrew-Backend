const path = require('path');
const http = require('http');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const puerto = Number(process.env.PORT) || 3000;
const app = http.createServer((req, res) => {
  res.end('gateway activo');
});

app.listen(puerto, () => {
  console.log(`gateway corriendo en el puerto ${puerto}`);
});

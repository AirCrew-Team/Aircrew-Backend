const http = require('node:http');

const port = Number(process.env.PORT) || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Backend AirCrew funcionando\n');
});

server.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});

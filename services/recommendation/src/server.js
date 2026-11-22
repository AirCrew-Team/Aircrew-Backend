const { port, nameService } = require('./config/env');
const app = require('./app');
const { startDeadlineJob } = require('./adapters/inbound/jobs/deadlineJob');

app.listen(port, () => {
  console.log(`${nameService} corriendo en el puerto ${port}`);
  startDeadlineJob();
});

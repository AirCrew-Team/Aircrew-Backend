const { port, nameService, ai } = require('./config/env');
const app = require('./app');
const { startDeadlineJob } = require('./adapters/inbound/jobs/deadlineJob');

// Sin IA el servicio arranca igual, pero se avisa: sus peticiones responden 503.
if (!ai.enabled) {
  console.warn(`[${nameService}] ${ai.disabledReason} Las recomendaciones y sugerencias de la IA responderán 503.`);
}

app.listen(port, () => {
  console.log(`${nameService} corriendo en el puerto ${port}`);
  startDeadlineJob();
});

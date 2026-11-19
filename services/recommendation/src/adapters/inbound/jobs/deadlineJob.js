const { deadlineCheckMs } = require('../../../config/env');
const crewClient = require('../../outbound/clients/crewClient');
const flightsClient = require('../../outbound/clients/flightsClient');
const notificationClient = require('../../outbound/clients/notificationClient');
const { serviceAuthorization } = require('../../outbound/clients/serviceToken');
const suggestionRepository = require('../../outbound/persistence/repositories/suggestionRepository');
const createHandleExpiredDeadlines = require('../../../application/use-cases/handleExpiredDeadlines');

// Adaptador de entrada por tiempo: cada DEADLINE_CHECK_MS revisa los plazos
// de «Enterado» vencidos. Si una revisión todavía corre, se salta la siguiente.
function startDeadlineJob() {
  const handleExpiredDeadlines = createHandleExpiredDeadlines({
    crewClient,
    flightsClient,
    suggestionRepository,
    notificationClient,
    serviceAuthorization,
  });

  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await handleExpiredDeadlines();
    } catch (error) {
      console.error(`Falló la revisión de plazos: ${error.message}`);
    } finally {
      running = false;
    }
  }, deadlineCheckMs);

  timer.unref();
  return timer;
}

module.exports = { startDeadlineJob };

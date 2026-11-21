const { adminServiceUrl, crewServiceKey } = require('../../../config/env');

// Nombre y email de varios usuarios en una sola consulta a Admin.
async function findUsersByIds(ids) {
  if (!crewServiceKey) {
    throw new Error('CREW_SERVICE_KEY no está configurado.');
  }

  const response = await fetch(`${adminServiceUrl}/users/lookup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-service-key': crewServiceKey,
    },
    body: JSON.stringify({ ids }),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Admin respondió ${response.status} al buscar usuarios.`);
  }

  return response.json();
}

module.exports = { findUsersByIds };
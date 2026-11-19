const { adminServiceUrl, crewServiceKey } = require('../../../config/env');

async function createUser({ name, email }) {
  if (!crewServiceKey) {
    const error = new Error('CREW_SERVICE_KEY no está configurado.');
    error.status = 500;
    throw error;
  }

  const response = await fetch(`${adminServiceUrl}/users/crew-registration`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-service-key': crewServiceKey,
    },
    body: JSON.stringify({
      name,
      email,
    }),
    signal: AbortSignal.timeout(5000),
  });

  const data = await response.json();

  if (!response.ok) {
    const message =
      typeof data.error === 'string'
        ? data.error
        : 'No se pudo crear el usuario en el servicio de Admin.';

    const error = new Error(message);
    error.status = response.status;
    if (data.code) error.code = data.code;
    if (data.field) error.field = data.field;
    throw error;
  }

  return data;
}

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

module.exports = { createUser, findUsersByIds };
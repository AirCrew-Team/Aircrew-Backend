const { adminServiceUrl, crewServiceKey } = require('../../../config/env');

async function createUser({ name, email }) {
  if (!crewServiceKey) {
    const error = new Error('CREW_SERVICE_KEY is not configured.');
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
        : 'Could not create user in admin service.';

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

module.exports = { createUser };
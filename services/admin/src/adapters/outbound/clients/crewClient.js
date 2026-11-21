const { crewServiceUrl, adminServiceKey } = require('../../../config/env');

// Perfiles de tripulante en Crew (rutas /internal/crew-members, con x-service-key).
// Los errores de datos de Crew (400, 404, 409) llegan tal cual a quien llamó;
// si Crew no responde o falla, es 502.
const PASSTHROUGH_STATUSES = [400, 404, 409];
const UNAVAILABLE_MESSAGE = 'No se pudo comunicar con el servicio de tripulación.';

function unavailable(cause) {
  const error = new Error(UNAVAILABLE_MESSAGE, { cause });
  error.status = 502;
  return error;
}

async function request(path, { method = 'GET', body } = {}) {
  if (!adminServiceKey) {
    const error = new Error('ADMIN_SERVICE_KEY no está configurado.');
    error.status = 503;
    throw error;
  }

  let response;

  try {
    response = await fetch(`${crewServiceUrl}/internal/crew-members${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'x-service-key': adminServiceKey,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (cause) {
    throw unavailable(cause);
  }

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    if (PASSTHROUGH_STATUSES.includes(response.status) && data && data.error) {
      const error = new Error(data.error);
      error.status = response.status;
      throw error;
    }
    throw unavailable(new Error(`Crew respondió ${response.status}.`));
  }

  return data;
}

function listProfiles() {
  return request('');
}

function getProfile(userId) {
  return request(`/${encodeURIComponent(userId)}`);
}

function createProfile(profile) {
  return request('', { method: 'POST', body: profile });
}

function updateProfile(userId, changes) {
  return request(`/${encodeURIComponent(userId)}`, { method: 'PATCH', body: changes });
}

function deleteProfile(userId) {
  return request(`/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

module.exports = { listProfiles, getProfile, createProfile, updateProfile, deleteProfile };

const {
  flightsServiceUrl,
  notificationServiceUrl,
  recommendationServiceUrl,
} = require('../../../config/env');
const { serviceAuthorization } = require('./serviceToken');

// Rutas internas (/internal/...) de flights, notification y recommendation que usa
// Admin al eliminar una cuenta, con token de servicio. Cualquier respuesta que no
// sea 2xx, o que el servicio no conteste, es un 502: ni un 404 de otro servicio
// debe llegar al frontend como «usuario no encontrado».
async function request(name, baseUrl, path, { method, body } = {}) {
  let response;

  try {
    response = await fetch(`${baseUrl}/internal${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: serviceAuthorization(),
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (cause) {
    throw Object.assign(new Error(`${name} no respondió: ${cause.message}`, { cause }), {
      status: 502,
    });
  }

  if (!response.ok) {
    throw Object.assign(new Error(`${name} respondió ${response.status}.`), { status: 502 });
  }

  return response.json().catch(() => null);
}

const user = (userId) => `/users/${encodeURIComponent(userId)}`;

const flightsClient = {
  releaseAssignments: (userId) =>
    request('Flights', flightsServiceUrl, `${user(userId)}/assignments`, { method: 'DELETE' }),
};

const notificationClient = {
  publishSlotVacated: (flight) =>
    request('Notification', notificationServiceUrl, '/alerts/slot-vacated', {
      method: 'POST',
      body: flight,
    }),
  deleteNotifications: (userId) =>
    request('Notification', notificationServiceUrl, `${user(userId)}/notifications`, {
      method: 'DELETE',
    }),
};

const recommendationClient = {
  deleteSuggestions: (userId) =>
    request('Recommendation', recommendationServiceUrl, `${user(userId)}/suggestions`, {
      method: 'DELETE',
    }),
};

module.exports = { flightsClient, notificationClient, recommendationClient };

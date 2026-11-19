const { flightsServiceUrl } = require('../../../config/env');

// Pide a Flights los vuelos del tripulante reenviando su propio token,
// así Flights responde solo con los vuelos de esa persona.
async function getMyAssignments(authorization) {
  let response;

  try {
    response = await fetch(`${flightsServiceUrl}/assignments/me`, {
      headers: { Accept: 'application/json', Authorization: authorization },
      signal: AbortSignal.timeout(5000),
    });
  } catch (cause) {
    const error = new Error('No se pudo consultar el servicio de vuelos.', {
      cause,
    });
    error.status = 502;
    throw error;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(
      (data && data.error) || 'No se pudo consultar el servicio de vuelos.'
    );
    error.status = response.status === 401 ? 401 : 502;
    throw error;
  }

  return data;
}

// Lecturas con el token del supervisor, para la pantalla de Tripulación del turno.
async function fetchJson(path, authorization) {
  let response;
  try {
    response = await fetch(`${flightsServiceUrl}${path}`, {
      headers: { Accept: 'application/json', Authorization: authorization },
      signal: AbortSignal.timeout(5000),
    });
  } catch (cause) {
    const error = new Error('No se pudo consultar el servicio de vuelos.', { cause });
    error.status = 502;
    throw error;
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error((data && data.error) || 'No se pudo consultar el servicio de vuelos.');
    error.status = response.status === 401 || response.status === 403 ? response.status : 502;
    throw error;
  }
  return data;
}

function getAssignments({ from, to }, authorization) {
  return fetchJson(`/assignments?${new URLSearchParams({ from, to })}`, authorization);
}

function listFlights({ from, to }, authorization) {
  return fetchJson(`/flights?${new URLSearchParams({ from, to })}`, authorization);
}

module.exports = { getMyAssignments, getAssignments, listFlights };

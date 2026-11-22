const { flightsServiceUrl } = require('../../../config/env');

// Flights puede tardar en la primera consulta recién arrancado:
// timeout amplio y un reintento si falla la conexión.
const TIMEOUT_MS = 10000;
const RETRIES = 1;

function unavailable(cause) {
  console.error(
    '[crew] No se pudo consultar Flights:',
    cause && (cause.cause ? `${cause.message} (${cause.cause.code || cause.cause.message})` : cause.message)
  );
  const error = new Error('No se pudo consultar el servicio de vuelos.', { cause });
  error.status = 502;
  return error;
}

async function fetchWithRetry(url, options) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (cause) {
      if (attempt >= RETRIES) throw unavailable(cause);
    }
  }
}

// Reenvía el token recibido: con el del tripulante, Flights responde solo sus vuelos;
// con el del supervisor, los de la pantalla de Tripulación del turno.
async function fetchJson(path, authorization) {
  const response = await fetchWithRetry(`${flightsServiceUrl}${path}`, {
    headers: { Accept: 'application/json', Authorization: authorization },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status >= 500) {
      console.error(`[crew] Flights respondió ${response.status} en ${path}:`, data && data.error);
    }
    const error = new Error((data && data.error) || 'No se pudo consultar el servicio de vuelos.');
    error.status = response.status === 401 || response.status === 403 ? response.status : 502;
    throw error;
  }
  return data;
}

function getMyAssignments(authorization) {
  return fetchJson('/assignments/me', authorization);
}

function getAssignments({ from, to }, authorization) {
  return fetchJson(`/assignments?${new URLSearchParams({ from, to })}`, authorization);
}

function listFlights({ from, to }, authorization) {
  return fetchJson(`/flights?${new URLSearchParams({ from, to })}`, authorization);
}

function getFlightsByIds(ids, authorization) {
  return fetchJson(`/flights?${new URLSearchParams({ ids: ids.join(',') })}`, authorization);
}

module.exports = { getMyAssignments, getAssignments, listFlights, getFlightsByIds };

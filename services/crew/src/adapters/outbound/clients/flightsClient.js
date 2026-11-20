const { flightsServiceUrl } = require('../../../config/env');

// Sin uso desde las ausencias por fechas; se queda para cuando se relacionen con vuelos.
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

module.exports = { getMyAssignments };

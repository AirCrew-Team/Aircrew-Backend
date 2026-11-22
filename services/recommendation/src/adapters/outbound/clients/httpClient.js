// Llama a otro servicio reenviando el token del supervisor.
// 400/401/403/404/409 se devuelven tal cual; lo demás es 502.
const PASSTHROUGH_STATUSES = [400, 401, 403, 404, 409];

async function requestJson(url, { authorization, method = 'GET', body, serviceName }) {
  const unavailable = `No se pudo consultar el servicio de ${serviceName}.`;
  let response;

  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: authorization,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (cause) {
    const error = new Error(unavailable, { cause });
    error.status = 502;
    throw error;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const passthrough = PASSTHROUGH_STATUSES.includes(response.status);
    const error = new Error(passthrough && data && data.error ? data.error : unavailable);
    error.status = passthrough ? response.status : 502;
    if (passthrough && data && data.code) error.code = data.code;
    if (passthrough && data && data.field) error.field = data.field;
    throw error;
  }

  return data;
}

module.exports = { requestJson };

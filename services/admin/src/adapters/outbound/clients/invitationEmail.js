// Contenido del correo de invitación, común a Resend y a SMTP.

// Mensaje que ve quien invita cuando el envío falla. El detalle del proveedor va al log:
// puede incluir datos de la cuenta del proveedor (por ejemplo, el correo de su dueño).
const SEND_FAILED_MESSAGE =
  'No se pudo enviar el correo de invitación. Revisa la configuración del correo.';

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return entities[character];
  });
}

function configError(message) {
  const error = new Error(message);
  error.status = 503;
  return error;
}

function getActivationUrl(token, crewActivationUrl) {
  if (!crewActivationUrl) {
    throw configError('Debe configurarse CREW_ACTIVATION_URL.');
  }

  let activationUrl;

  try {
    activationUrl = new URL(crewActivationUrl);
  } catch {
    throw configError('CREW_ACTIVATION_URL debe ser una URL válida.');
  }

  if (!['http:', 'https:'].includes(activationUrl.protocol)) {
    throw configError('CREW_ACTIVATION_URL debe usar HTTP o HTTPS.');
  }

  if (token) {
    activationUrl.searchParams.set('token', token);
  }

  return activationUrl;
}

function buildCrewInvitation({ name, token, crewActivationUrl }) {
  const activationUrl = getActivationUrl(token, crewActivationUrl).toString();
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(activationUrl);

  return {
    subject: 'Activa tu cuenta de AirCrew',
    html: `<p>Hola ${safeName},</p><p>Para activar tu cuenta y crear tu contraseña, abre este enlace:</p><p><a href="${safeUrl}">Activar cuenta</a></p><p>Si no solicitaste esta cuenta, puedes ignorar este correo.</p>`,
    text: `Hola ${name},\n\nPara activar tu cuenta y crear tu contraseña, abre este enlace:\n${activationUrl}\n\nSi no solicitaste esta cuenta, puedes ignorar este correo.`,
  };
}

// Registra el detalle y devuelve el 502 genérico.
function sendFailedError(provider, cause) {
  console.error(`Fallo al enviar la invitación con ${provider}:`, cause);
  const error = new Error(SEND_FAILED_MESSAGE, { cause });
  error.status = 502;
  return error;
}

module.exports = {
  SEND_FAILED_MESSAGE,
  buildCrewInvitation,
  configError,
  getActivationUrl,
  sendFailedError,
};

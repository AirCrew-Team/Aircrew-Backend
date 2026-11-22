// Contenido de los correos de invitación y de recuperación, común a Resend y a SMTP.

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

// Enlace a una pantalla del frontend con ?token=. Sin token solo valida la URL base.
// variableName es la variable de entorno que se nombra en el 503.
function getLinkUrl(token, baseUrl, variableName) {
  if (!baseUrl) {
    throw configError(`Debe configurarse ${variableName}.`);
  }

  let linkUrl;

  try {
    linkUrl = new URL(baseUrl);
  } catch {
    throw configError(`${variableName} debe ser una URL válida.`);
  }

  if (!['http:', 'https:'].includes(linkUrl.protocol)) {
    throw configError(`${variableName} debe usar HTTP o HTTPS.`);
  }

  if (token) {
    linkUrl.searchParams.set('token', token);
  }

  return linkUrl;
}

function getActivationUrl(token, crewActivationUrl) {
  return getLinkUrl(token, crewActivationUrl, 'CREW_ACTIVATION_URL');
}

function getPasswordResetUrl(token, passwordResetUrl) {
  return getLinkUrl(token, passwordResetUrl, 'PASSWORD_RESET_URL');
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

function buildPasswordReset({ name, token, passwordResetUrl }) {
  const resetUrl = getPasswordResetUrl(token, passwordResetUrl).toString();
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(resetUrl);
  const intro =
    'recibimos una solicitud para restablecer tu contraseña. Abre este enlace para crear una nueva (vence en 10 minutos):';
  const closing = 'Si no la solicitaste, ignora este correo: tu contraseña no cambia.';

  return {
    subject: 'Restablece tu contraseña de AirCrew',
    html: `<p>Hola ${safeName}, ${intro}</p><p><a href="${safeUrl}">Restablecer contraseña</a></p><p>${closing}</p>`,
    text: `Hola ${name}, ${intro}\n${resetUrl}\n\n${closing}`,
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
  buildPasswordReset,
  configError,
  getActivationUrl,
  getPasswordResetUrl,
  sendFailedError,
};

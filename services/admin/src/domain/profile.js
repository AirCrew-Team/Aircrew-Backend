const { DomainError } = require('./errors');
const { isValidPassword } = require('./value-objects/password');
const { findUsCity } = require('./usCities');

// Datos personales de la cuenta (Configuración), comunes a los tres roles.
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const phonePattern = /^\+?\d{7,15}$/;
const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;

// Preferencias de notificaciones de cada rol. El super_admin no tiene: su perfil trae
// notifications null y no puede enviarlas.
const NOTIFICATION_KEYS = new Map([
  ['crew', ['replacement_assigned']],
  ['supervisor', ['absence_reported', 'absence_covered']],
]);

function startsWith(data, bytes) {
  return data.subarray(0, bytes.length).equals(bytes);
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const RIFF = Buffer.from('RIFF');
const WEBP = Buffer.from('WEBP');

// Comprueba los primeros bytes de cada tipo. WEBP: «RIFF», 4 bytes de tamaño y «WEBP».
const PHOTO_TYPES = new Map([
  ['image/png', (data) => startsWith(data, PNG)],
  ['image/jpeg', (data) => startsWith(data, JPEG)],
  [
    'image/webp',
    (data) => startsWith(data, RIFF) && data.subarray(8, 12).equals(WEBP),
  ],
]);

function notificationKeysFor(role) {
  return NOTIFICATION_KEYS.get(role) || [];
}

// Datos laborales: solo del supervisor (los asigna un super_admin). Los demás roles, null.
function employmentOf(row) {
  if (row.role !== 'supervisor') return null;

  return {
    employee_code: row.employee_code ?? null,
    base: row.base ?? null,
    shift: row.shift ?? null,
    operational_status: row.operational_status ?? null,
  };
}

// Perfil público: sin hash, sin bytes de la foto y con las preferencias del rol.
function toProfile(row) {
  let notifications = null;
  if (NOTIFICATION_KEYS.has(row.role)) {
    notifications = {};
    for (const key of notificationKeysFor(row.role)) {
      notifications[key] = row[`notify_${key}`];
    }
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    is_active: row.is_active,
    created_at: row.created_at,
    phone: row.phone,
    residence: row.residence,
    password_changed_at: row.password_changed_at,
    photo_updated_at: row.photo_updated_at || null,
    notifications,
    employment: employmentOf(row),
  };
}

// Vacío o solo espacios → null.
function parsePhone(phone) {
  if (phone === null) return null;
  if (typeof phone !== 'string') {
    throw new DomainError('El celular debe tener de 7 a 15 dígitos y puede empezar con +.');
  }

  const compact = phone.replace(/\s+/g, '');
  if (compact === '') return null;
  if (!phonePattern.test(compact)) {
    throw new DomainError('El celular debe tener de 7 a 15 dígitos y puede empezar con +.');
  }

  return compact;
}

// Vacío o solo espacios → null. Si no, una ciudad del catálogo, con la forma del catálogo.
function parseResidence(residence) {
  if (residence === null) return null;
  if (typeof residence === 'string' && residence.trim() === '') return null;

  const city = findUsCity(residence);
  if (!city) {
    throw new DomainError('Elige una ciudad de Estados Unidos de la lista.');
  }

  return city;
}

function parseNotifications(role, notifications) {
  // Un rol sin preferencias no puede enviarlas, ni siquiera vacías o null.
  if (!NOTIFICATION_KEYS.has(role)) {
    throw new DomainError(
      'Hay una preferencia de notificaciones que no corresponde a tu rol.'
    );
  }

  if (
    typeof notifications !== 'object' ||
    notifications === null ||
    Array.isArray(notifications)
  ) {
    throw new DomainError(
      'Las preferencias de notificaciones deben ser un objeto con valores true o false.'
    );
  }

  const allowed = notificationKeysFor(role);
  const parsed = {};
  for (const [key, value] of Object.entries(notifications)) {
    if (!allowed.includes(key)) {
      throw new DomainError(
        'Hay una preferencia de notificaciones que no corresponde a tu rol.'
      );
    }
    if (typeof value !== 'boolean') {
      throw new DomainError(
        'Las preferencias de notificaciones deben ser un objeto con valores true o false.'
      );
    }
    parsed[key] = value;
  }

  return parsed;
}

// Cambios del propio perfil. Solo se aplican los campos enviados.
function validateProfileUpdate(role, input) {
  const { phone, residence, notifications } = input || {};
  const changes = {};

  if (phone !== undefined) changes.phone = parsePhone(phone);
  if (residence !== undefined) changes.residence = parseResidence(residence);
  if (notifications !== undefined) {
    const parsed = parseNotifications(role, notifications);
    // Un objeto vacío no cambia nada: no cuenta como cambio.
    if (Object.keys(parsed).length > 0) changes.notifications = parsed;
  }

  if (Object.keys(changes).length === 0) {
    throw new DomainError('Envía al menos uno de: phone, residence, notifications.');
  }

  return changes;
}

// Decodifica la foto (base64 sin el prefijo data:) y comprueba tipo, tamaño y firma.
function parsePhoto(input) {
  const { mime_type: mimeType, data_base64: dataBase64 } = input || {};

  if (typeof mimeType !== 'string' || typeof dataBase64 !== 'string' || dataBase64 === '') {
    throw new DomainError('Se requieren mime_type y data_base64.');
  }

  // Map: un tipo como «constructor» no encuentra nada heredado.
  const matchesType = PHOTO_TYPES.get(mimeType);
  if (!matchesType) {
    throw new DomainError('La foto debe ser PNG, JPEG o WEBP.');
  }

  if (dataBase64.length % 4 !== 0 || !base64Pattern.test(dataBase64)) {
    throw new DomainError('El contenido de la foto no está en base64.');
  }

  const data = Buffer.from(dataBase64, 'base64');

  if (data.length > MAX_PHOTO_BYTES) {
    throw new DomainError('La foto no puede pesar más de 2 MB.');
  }

  if (!matchesType(data)) {
    throw new DomainError('El archivo no coincide con el tipo de foto indicado.');
  }

  return { mimeType, sizeBytes: data.length, data };
}

// Datos del cambio de contraseña con sesión.
function validatePasswordChange(input) {
  const { current_password: currentPassword, new_password: newPassword } = input || {};

  if (
    typeof currentPassword !== 'string' ||
    currentPassword === '' ||
    !isValidPassword(newPassword)
  ) {
    throw new DomainError(
      'Se requieren la contraseña actual y una nueva de 8 a 72 bytes.'
    );
  }

  if (newPassword === currentPassword) {
    throw new DomainError('La nueva contraseña debe ser distinta de la actual.');
  }

  return { currentPassword, newPassword };
}

module.exports = {
  parsePhone,
  toProfile,
  validateProfileUpdate,
  parsePhoto,
  validatePasswordChange,
};

const { DomainError } = require('../errors');

// Foto de una aeronave: las mismas reglas que la foto de perfil de Admin.
// PNG, JPEG o WEBP de hasta 2 MB ya decodificada, en base64 sin el prefijo data:.
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const RIFF = Buffer.from('RIFF');
const WEBP = Buffer.from('WEBP');

function startsWith(data, bytes) {
  return data.subarray(0, bytes.length).equals(bytes);
}

// Comprueba los primeros bytes de cada tipo. WEBP: «RIFF», 4 bytes de tamaño y «WEBP».
const PHOTO_TYPES = new Map([
  ['image/png', (data) => startsWith(data, PNG)],
  ['image/jpeg', (data) => startsWith(data, JPEG)],
  ['image/webp', (data) => startsWith(data, RIFF) && data.subarray(8, 12).equals(WEBP)],
]);

function parseAircraftPhoto(input) {
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

module.exports = { parseAircraftPhoto, MAX_PHOTO_BYTES };

const { DomainError } = require('../errors');
const { normalizeFileName } = require('./fileName');

// Copia del certificado: PDF, PNG o JPG de hasta 5 MB (el mismo límite del
// formulario), en base64 dentro del JSON, sin el prefijo data:.
const MAX_CERTIFICATE_FILE_BYTES = 5 * 1024 * 1024;
const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;

// Primeros bytes y extensión de cada tipo permitido.
const FILE_TYPES = new Map([
  ['application/pdf', { signature: Buffer.from('%PDF-'), extension: '.pdf' }],
  [
    'image/png',
    { signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), extension: '.png' },
  ],
  ['image/jpeg', { signature: Buffer.from([0xff, 0xd8, 0xff]), extension: '.jpg' }],
]);

function parseCertificateFile(file) {
  const { file_name: fileName, mime_type: mimeType, data_base64: dataBase64 } = file || {};

  if (
    typeof fileName !== 'string' ||
    fileName.trim() === '' ||
    typeof mimeType !== 'string' ||
    typeof dataBase64 !== 'string' ||
    dataBase64 === ''
  ) {
    throw new DomainError(
      'La copia del certificado debe incluir file_name, mime_type y data_base64.'
    );
  }

  // Map: un tipo como «constructor» no encuentra nada heredado.
  const type = FILE_TYPES.get(mimeType);
  if (!type) {
    throw new DomainError('La copia del certificado debe ser un PDF, PNG o JPG.');
  }

  if (dataBase64.length % 4 !== 0 || !base64Pattern.test(dataBase64)) {
    throw new DomainError('El contenido de la copia no está en base64.');
  }

  const data = Buffer.from(dataBase64, 'base64');

  if (data.length > MAX_CERTIFICATE_FILE_BYTES) {
    throw new DomainError('El archivo supera los 5 MB.');
  }

  if (!data.subarray(0, type.signature.length).equals(type.signature)) {
    throw new DomainError('El archivo no coincide con el tipo indicado.');
  }

  return {
    fileName: normalizeFileName(fileName, type.extension, 'certificado'),
    mimeType,
    sizeBytes: data.length,
    data,
  };
}

module.exports = { parseCertificateFile, MAX_CERTIFICATE_FILE_BYTES };

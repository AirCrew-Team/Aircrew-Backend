// Nombre con el que se guarda un archivo subido (comprobante o certificado).
const MAX_FILE_NAME_LENGTH = 255;
// Solo se quitan estas extensiones: en «Dr. Pérez» el punto es del nombre.
const KNOWN_EXTENSION = /\.(pdf|png|jpe?g)$/i;

// La extensión sale del tipo comprobado, no de la que traiga el nombre: así
// un PDF llamado «informe.html» no se descarga como HTML. La base se recorta
// para que el total no pase de 255 caracteres, sin partir un carácter de dos
// unidades UTF-16 (emoji).
function normalizeFileName(fileName, extension, fallback) {
  const baseName = fileName.trim().replace(KNOWN_EXTENSION, '').trim() || fallback;
  const room = MAX_FILE_NAME_LENGTH - extension.length;
  const trimmed = baseName.slice(0, room).replace(/[\uD800-\uDBFF]$/, '');

  return `${trimmed}${extension}`;
}

module.exports = { normalizeFileName };

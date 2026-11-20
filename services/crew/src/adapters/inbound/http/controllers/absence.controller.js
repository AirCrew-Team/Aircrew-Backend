// Nombre para Content-Disposition: sin rutas, comillas ni saltos de línea y
// solo en ASCII (Node rechaza otros caracteres en las cabeceras).
function toSafeFileName(name) {
  const safe = String(name)
    .split(/[\\/]/)
    .pop()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/["\u0000-\u001f\u007f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .trim();

  return safe || 'comprobante';
}

function createAbsenceController({
  reportAbsence,
  getAbsences,
  getAbsenceById,
  getAbsenceAttachment,
  coverAbsence,
}) {
  async function create(req, res, next) {
    try {
      const absence = await reportAbsence(
        req.user,
        req.headers.authorization,
        req.body
      );
      return res.status(201).json(absence);
    } catch (error) {
      return next(error);
    }
  }

  async function list(req, res, next) {
    try {
      const absences = await getAbsences({ status: req.query.status });
      return res.status(200).json(absences);
    } catch (error) {
      return next(error);
    }
  }

  async function getById(req, res, next) {
    try {
      const absence = await getAbsenceById(req.params.id);
      return res.status(200).json(absence);
    } catch (error) {
      return next(error);
    }
  }

  async function downloadAttachment(req, res, next) {
    try {
      const attachment = await getAbsenceAttachment(req.params.id);
      res.set({
        'Content-Type': attachment.mime_type,
        'Content-Disposition': `attachment; filename="${toSafeFileName(attachment.file_name)}"`,
        'X-Content-Type-Options': 'nosniff',
        // Documentos médicos: que no queden en cachés del navegador o proxies.
        'Cache-Control': 'private, no-store',
      });
      return res.status(200).send(attachment.data);
    } catch (error) {
      return next(error);
    }
  }

  async function cover(req, res, next) {
    try {
      const absence = await coverAbsence(req.params.id, req.body);
      return res.status(200).json(absence);
    } catch (error) {
      return next(error);
    }
  }

  return { create, list, getById, downloadAttachment, cover };
}

module.exports = createAbsenceController;

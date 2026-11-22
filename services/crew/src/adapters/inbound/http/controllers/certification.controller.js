// Nombre para Content-Disposition: sin rutas, comillas ni saltos de línea y
// solo en ASCII (Node rechaza otros caracteres en las cabeceras).
function toSafeFileName(name) {
  const safe = String(name)
    .split(/[\\/]/)
    .pop()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/["\u0000-\u001f\u007f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .trim();

  return safe || 'certificado';
}

// Ejecuta un caso de uso y responde con el status indicado (204: sin cuerpo).
function respond(status, run) {
  return async function handle(req, res, next) {
    try {
      const result = await run(req);
      return status === 204 ? res.status(204).end() : res.status(status).json(result);
    } catch (error) {
      return next(error);
    }
  };
}

function createCertificationController(manageCertifications) {
  // Copia del certificado: se descarga con su tipo y sin quedar en cachés.
  async function downloadFile(req, res, next) {
    try {
      const file = await manageCertifications.getCertificationFile(req.params.userId);
      res.set({
        'Content-Type': file.mime_type,
        'Content-Disposition': `attachment; filename="${toSafeFileName(file.file_name)}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      });
      return res.status(200).send(file.data);
    } catch (error) {
      return next(error);
    }
  }

  return {
    options: respond(200, () => manageCertifications.getOptions()),
    stats: respond(200, () => manageCertifications.getCertificationStats()),
    uncertified: respond(200, () => manageCertifications.listUncertifiedCrew()),
    list: respond(200, (req) =>
      manageCertifications.listCertifications({
        page: req.query.page,
        page_size: req.query.page_size,
        search: req.query.search,
        status: req.query.status,
      })
    ),
    getById: respond(200, (req) => manageCertifications.getCertification(req.params.userId)),
    save: respond(200, (req) =>
      manageCertifications.saveCertification(req.user, req.params.userId, req.body)
    ),
    remove: respond(204, (req) => manageCertifications.deleteCertification(req.params.userId)),
    downloadFile,
  };
}

module.exports = createCertificationController;

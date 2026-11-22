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

function createAircraftController(manageAircraft) {
  async function photo(req, res, next) {
    try {
      const { mime_type: mimeType, data } = await manageAircraft.getPhoto(req.params.id);
      res.set({
        'Content-Type': mimeType,
        'X-Content-Type-Options': 'nosniff',
        // El <img> vuelve a preguntar; la URL cambia con ?v= al subir otra.
        'Cache-Control': 'private, no-cache',
      });
      return res.status(200).send(data);
    } catch (error) {
      return next(error);
    }
  }

  return {
    list: respond(200, (req) =>
      manageAircraft.listAircraft({
        page: req.query.page,
        page_size: req.query.page_size,
        search: req.query.search,
        status: req.query.status,
      })
    ),
    stats: respond(200, () => manageAircraft.getAircraftStats()),
    options: respond(200, () => manageAircraft.getAircraftOptions()),
    listOperating: respond(200, () => manageAircraft.getOperatingAircraft()),
    manifest: respond(200, () => manageAircraft.getFleetManifest()),
    create: respond(201, (req) => manageAircraft.createAircraft(req.body)),
    update: respond(200, (req) => manageAircraft.updateAircraft(req.params.id, req.body)),
    remove: respond(204, (req) => manageAircraft.deleteAircraft(req.params.id)),
    report: respond(200, (req) => manageAircraft.getAircraftReport(req.params.id)),
    setTask: respond(200, (req) =>
      manageAircraft.setMaintenanceTask(req.params.id, req.params.index, req.body)
    ),
    release: respond(200, (req) => manageAircraft.releaseToService(req.params.id)),
    savePhoto: respond(200, (req) => manageAircraft.savePhoto(req.params.id, req.body)),
    photo,
    deletePhoto: respond(204, (req) => manageAircraft.deletePhoto(req.params.id)),
  };
}

module.exports = createAircraftController;

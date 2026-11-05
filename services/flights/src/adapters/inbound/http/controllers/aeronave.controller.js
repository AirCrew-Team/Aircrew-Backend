function crearControladorAeronaves({
  crearAeronave,
  obtenerAeronavesOperativas,
  obtenerResumenAeronaves,
}) {
  async function crear(req, res, next) {
    try {
      const aeronave = await crearAeronave(req.body);
      return res.status(201).json(aeronave);
    } catch (error) {
      return next(error);
    }
  }

  async function listarActivas(req, res, next) {
    try {
      const aeronaves = await obtenerAeronavesOperativas();
      return res.status(200).json(aeronaves);
    } catch (error) {
      return next(error);
    }
  }

  async function obtenerResumen(req, res, next) {
    try {
      const resumen = await obtenerResumenAeronaves();
      return res.status(200).json(resumen);
    } catch (error) {
      return next(error);
    }
  }

  return { crear, listarActivas, obtenerResumen };
}

module.exports = crearControladorAeronaves;

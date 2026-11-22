const { parseRegenerateReason } = require('../../../../domain/entities/replacementRequest');

function createRecommendationController({
  getCandidates,
  suggestReplacements,
  confirmReplacement,
}) {
  async function listCandidates(req, res, next) {
    try {
      const result = await getCandidates(req.params.id, req.headers.authorization);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  // Interno (lo llama Crew al reportar): responde de inmediato y busca en
  // segundo plano; el resultado llega por SSE (absence:suggestions_ready).
  function suggest(req, res) {
    const { authorization } = req.headers;
    const { id } = req.params;

    suggestReplacements(id, authorization).catch((error) =>
      console.error(`No se pudieron buscar reemplazos para ${id}: ${error.message}`)
    );

    return res.status(202).json({ absence_id: id, suggestions_state: 'searching' });
  }

  // El supervisor pide otra ronda, opcionalmente con un motivo:
  // espera el resultado y devuelve los candidatos.
  async function regenerate(req, res, next) {
    try {
      const reason = parseRegenerateReason(req.body);
      await suggestReplacements(req.params.id, req.headers.authorization, { reason });
      const result = await getCandidates(req.params.id, req.headers.authorization);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  async function confirm(req, res, next) {
    try {
      const result = await confirmReplacement(
        req.params.id,
        req.headers.authorization,
        req.body,
        req.user
      );
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  return { listCandidates, suggest, regenerate, confirm };
}

module.exports = createRecommendationController;

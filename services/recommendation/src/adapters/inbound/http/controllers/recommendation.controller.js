function createRecommendationController({ getCandidates, confirmReplacement }) {
  async function listCandidates(req, res, next) {
    try {
      const result = await getCandidates(
        req.params.id,
        req.headers.authorization
      );
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
        req.body
      );
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  return { listCandidates, confirm };
}

module.exports = createRecommendationController;

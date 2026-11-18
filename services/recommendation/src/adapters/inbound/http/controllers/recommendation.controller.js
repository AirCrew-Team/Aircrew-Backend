function createRecommendationController({ getCandidates }) {
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

  return { listCandidates };
}

module.exports = createRecommendationController;

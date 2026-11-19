function createAssignmentController({
  assignCrewMember,
  replaceCrewMember,
  getAssignments,
  getMyAssignments,
  getMyNextAssignment,
  acknowledgeReplacement,
  revertReplacement,
}) {
  async function create(req, res, next) {
    try {
      const assignment = await assignCrewMember(req.params.id, req.body);
      return res.status(201).json(assignment);
    } catch (error) {
      return next(error);
    }
  }

  async function replace(req, res, next) {
    try {
      const result = await replaceCrewMember(req.params.id, req.body, req.user);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  async function list(req, res, next) {
    try {
      const assignments = await getAssignments({
        from: req.query.from,
        to: req.query.to,
      });
      return res.status(200).json(assignments);
    } catch (error) {
      return next(error);
    }
  }

  async function listMine(req, res, next) {
    try {
      const assignments = await getMyAssignments(req.user, req.query);
      return res.status(200).json(assignments);
    } catch (error) {
      return next(error);
    }
  }

  async function getMyNext(req, res, next) {
    try {
      const assignment = await getMyNextAssignment(req.user);
      return res.status(200).json(assignment);
    } catch (error) {
      return next(error);
    }
  }

  async function acknowledge(req, res, next) {
    try {
      await acknowledgeReplacement(req.user, req.params.id);
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  }

  async function revert(req, res, next) {
    try {
      const result = await revertReplacement(req.params.id, req.body);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }

  return { create, replace, list, listMine, getMyNext, acknowledge, revert };
}

module.exports = createAssignmentController;

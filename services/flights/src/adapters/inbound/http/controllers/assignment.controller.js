function createAssignmentController({
  assignCrewMember,
  getMyAssignments,
  getMyNextAssignment,
}) {
  async function create(req, res, next) {
    try {
      const assignment = await assignCrewMember(req.params.id, req.body);
      return res.status(201).json(assignment);
    } catch (error) {
      return next(error);
    }
  }

  async function listMine(req, res, next) {
    try {
      const assignments = await getMyAssignments(req.user);
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

  return { create, listMine, getMyNext };
}

module.exports = createAssignmentController;

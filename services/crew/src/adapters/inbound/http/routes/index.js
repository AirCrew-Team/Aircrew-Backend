const express = require('express');
const healthRoutes = require('./health.routes');
const docsRoutes = require('./docs.routes');
const crewMembersRoutes = require('./crewMember.routes');
const absenceRoutes = require('./absence.routes');
const { shiftsRouter, shiftCrewRouter } = require('./shift.routes');


const router = express.Router();

router.use('/', healthRoutes);
router.use('/docs', docsRoutes);
router.use('/crew-members', crewMembersRoutes);
router.use('/absences', absenceRoutes);
router.use('/shifts', shiftsRouter);
router.use('/shift-crew', shiftCrewRouter);

module.exports = router;

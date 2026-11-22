const express = require('express');
const healthRoutes = require('./health.routes');
const docsRoutes = require('./docs.routes');
const crewMembersRoutes = require('./crewMember.routes');
const absenceRoutes = require('./absence.routes');
const { shiftsRouter, shiftCrewRouter } = require('./shift.routes');
const { crewMembersRouter, usersRouter } = require('./internal.routes');
const certificationRoutes = require('./certification.routes');


const router = express.Router();

router.use('/', healthRoutes);
router.use('/docs', docsRoutes);
router.use('/crew-members', crewMembersRoutes);
router.use('/absences', absenceRoutes);
router.use('/shifts', shiftsRouter);
router.use('/shift-crew', shiftCrewRouter);
// Pantalla Certificaciones: super_admin; GET /certifications/me, el tripulante.
router.use('/certifications', certificationRoutes);
// Solo para Admin (x-service-key).
router.use('/internal/crew-members', crewMembersRouter);
router.use('/internal/users', usersRouter);

module.exports = router;

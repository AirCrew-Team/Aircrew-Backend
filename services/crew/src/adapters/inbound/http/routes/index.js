const express = require('express');
const healthRoutes = require('./health.routes');
const docsRoutes = require('./docs.routes');
const crewMembersRoutes = require('./crewMember.routes');
const absenceRoutes = require('./absence.routes');
const internalRoutes = require('./internal.routes');
const certificationRoutes = require('./certification.routes');


const router = express.Router();

router.use('/', healthRoutes);
router.use('/docs', docsRoutes);
router.use('/crew-members', crewMembersRoutes);
router.use('/absences', absenceRoutes);
// Pantalla Certificaciones: solo super_admin.
router.use('/certifications', certificationRoutes);
// Solo para Admin (x-service-key).
router.use('/internal/crew-members', internalRoutes);

module.exports = router;

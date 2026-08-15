const router = require('express').Router();
const c = require('../controllers/app.controller');

router.get('/version', c.getVersion);

module.exports = router;

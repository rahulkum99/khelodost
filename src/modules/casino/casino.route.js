const express = require('express');
const router = express.Router();
const casinoController = require('./casino.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

router.get('/', authenticate, casinoController.launchGame);

router.post('/callback/bet', casinoController.callbackBet);

module.exports = router;



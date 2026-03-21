const express = require('express');
const router = express.Router();
const casinoController = require('./casino.controller');
const { authenticate } = require('../../middlewares/auth.middleware');


router.get('/list/spribe', casinoController.listSpribeGames);
router.get('/list/inout', casinoController.listInoutGames);
router.get('/list/mac88', casinoController.listMac88Games);

router.get('/:gamehash/launch', authenticate, casinoController.launchGame);

router.post('/callback/bet', casinoController.callbackBet);

module.exports = router;



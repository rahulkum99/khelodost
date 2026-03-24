const express = require('express');
const router = express.Router();
const casinoController = require('./casino.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const path = require('path');

const GAMELIST_DIR = path.join(__dirname, 'gamelist');

// Serve images from `src/modules/casino/gamelist/`.
// JSON field `gameImage` uses paths like: `mac88/xyz.png`
router.use('/gamelist/assets', express.static(GAMELIST_DIR));

// Keep game list routes above `/:gamehash/launch` so fixed words aren't captured as gamehash.
router.get('/gamelist', casinoController.listGameTypes);
router.get('/gamelist/anderbahar', casinoController.anderbaharGameList);
router.get('/gamelist/game/:gamehash', casinoController.getGameByHash);
router.get('/gamelist/:type', casinoController.listGamesByType);

// Optional alias: direct per-game endpoint without "gamelist" in URL.
router.get('/game/:gamehash', casinoController.getGameByHash);

router.get('/:gamehash/launch', authenticate, casinoController.launchGame);

router.post('/callback/bet', casinoController.callbackBet);

module.exports = router;



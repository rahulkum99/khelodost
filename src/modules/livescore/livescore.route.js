const express = require('express');
const router = express.Router();

const livescoreController = require('./livescore.controller');

// Proxy LIVE TV endpoint: returns upstream response as-is
// GET /api/livescore/tv?eventId=34154017&sport=cricket
router.get('/tv', livescoreController.getLiveTv);

// Proxy Scorecard endpoint: returns upstream response as-is
// GET /api/livescore/scorecard?eventId=34370937&sport=cricket
router.get('/scorecard', livescoreController.getScorecard);

module.exports = router;


const livescoreService = require('./livescore.service');

const validateQuery = (req, res) => {
  const { eventId, sport } = req.query || {};
  if (!eventId || !String(eventId).trim()) {
    res.status(400).json({ success: false, message: 'eventId is required' });
    return null;
  }
  if (!sport || !String(sport).trim()) {
    res.status(400).json({ success: false, message: 'sport is required' });
    return null;
  }
  return { eventId: String(eventId).trim(), sport: String(sport).trim() };
};

const getLiveTv = async (req, res) => {
  try {
    const q = validateQuery(req, res);
    if (!q) return;

    const upstream = await livescoreService.fetchLiveTv({
      eventId: q.eventId,
      sport: q.sport,
    });

    // Mirror upstream status + content-type; body is passed as-is (Buffer)
    if (upstream.contentType) {
      res.set('content-type', upstream.contentType);
    }
    return res.status(upstream.status).send(upstream.body);
  } catch (err) {
    console.error('getLiveTv error:', err);
    return res.status(502).json({
      success: false,
      message: err.message || 'Failed to fetch live tv',
    });
  }
};

const getScorecard = async (req, res) => {
  try {
    const q = validateQuery(req, res);
    if (!q) return;

    const upstream = await livescoreService.fetchScorecard({
      eventId: q.eventId,
      sport: q.sport,
    });

    if (upstream.contentType) {
      res.set('content-type', upstream.contentType);
    }
    return res.status(upstream.status).send(upstream.body);
  } catch (err) {
    console.error('getScorecard error:', err);
    return res.status(502).json({
      success: false,
      message: err.message || 'Failed to fetch scorecard',
    });
  }
};

module.exports = {
  getLiveTv,
  getScorecard,
};


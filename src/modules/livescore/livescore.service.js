const axios = require('axios');

const DEFAULT_LIVE_TV_URL = 'https://apis.professorji.in/api/tv';
const DEFAULT_SCORECARD_URL = 'https://apis.professorji.in/api/scorecard';

const buildUpstreamUrl = ({ baseUrl, eventId, sport }) => {
  const raw = String(baseUrl || '').trim();
  const url = new URL(raw);
  url.searchParams.set('eventId', String(eventId));
  url.searchParams.set('sport', String(sport));
  return url.toString();
};

const fetchLiveTv = async ({ eventId, sport }) => {
  const url = buildUpstreamUrl({
    baseUrl: (process.env.LIVE_TV_URL || '').trim() || DEFAULT_LIVE_TV_URL,
    eventId,
    sport,
  });

  const resp = await axios.get(url, {
    // Preserve body exactly (even if not JSON)
    responseType: 'arraybuffer',
    timeout: Number(process.env.API_TIMEOUT || 15000),
    // Don't throw on non-2xx; we want to mirror upstream status/body
    validateStatus: () => true,
  });

  return {
    status: resp.status,
    contentType: resp.headers?.['content-type'],
    body: resp.data,
  };
};

const fetchScorecard = async ({ eventId, sport }) => {
  const url = buildUpstreamUrl({
    baseUrl: (process.env.SCORECARD_URL || '').trim() || DEFAULT_SCORECARD_URL,
    eventId,
    sport,
  });

  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: Number(process.env.API_TIMEOUT || 15000),
    validateStatus: () => true,
  });

  return {
    status: resp.status,
    contentType: resp.headers?.['content-type'],
    body: resp.data,
  };
};

module.exports = {
  fetchLiveTv,
  fetchScorecard,
};


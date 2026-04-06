const axios = require('axios');

const API_URL = process.env.CRICKET_MATCHES_API_URL;

let latestData = [];
let isFetching = false; // Flag to prevent overlapping requests

/** Exclude list entries whose event name references T10 or XI (e.g. "Melbourne Stars XI v ..."). */
const isBlockedEventName = (eventName) => {
  const name = String(eventName ?? '');
  return /\bT10\b/i.test(name) || /\bXI\b/i.test(name);
};

const filterMatchesByEventName = (data) => {
  if (!Array.isArray(data)) {
    return data;
  }
  return data.filter((item) => !isBlockedEventName(item?.eventName));
};

const fetchCricketData = async () => {
  // If a request is already in progress, skip this call
  if (isFetching) {
    return latestData.length > 0 ? latestData : null;
  }

  isFetching = true;
  try {
    const response = await axios.get(API_URL, {
      timeout: 15000, // Increased to 15 seconds
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    });

    const raw = response.data;
    latestData = Array.isArray(raw) ? filterMatchesByEventName(raw) : raw;
    return latestData;
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      console.error('Cricket API error: Request timeout - API took longer than 15 seconds');
    } else if (error.response) {
      console.error('Cricket API error: Server responded with status', error.response.status);
    } else if (error.request) {
      console.error('Cricket API error: No response received from server');
    } else {
      console.error('Cricket API error:', error.message);
    }
    // Return cached data if available instead of null
    return latestData.length > 0 ? latestData : null;
  } finally {
    isFetching = false; // Reset flag when request completes
  }
};

const getLatestCricketData = () => latestData;

module.exports = {
  fetchCricketData,
  getLatestCricketData,
};

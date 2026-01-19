const axios = require('axios');

const API_URL = process.env.CRICKET_MATCHES_API_URL;

let latestData = [];
let isFetching = false; // Flag to prevent overlapping requests

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

    latestData = response.data;
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

const axios = require('axios');

const API_URL = process.env.TENNIS_MATCHES_API_URL;

let latestData = [];
let isFetching = false; // Flag to prevent overlapping requests

const fetchTennisData = async () => {
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
      console.error('Tennis API error: Request timeout - API took longer than 15 seconds');
    } else if (error.response) {
      console.error('Tennis API error: Server responded with status', error.response.status);
    } else if (error.request) {
      console.error('Tennis API error: No response received from server');
    } else {
      console.error('Tennis API error:', error.message);
    }
    // Return cached data if available instead of null
    return latestData.length > 0 ? latestData : null;
  } finally {
    isFetching = false; // Reset flag when request completes
  }
};

const getLatestTennisData = () => latestData;

module.exports = {
  fetchTennisData,
  getLatestTennisData,
};

const axios = require('axios');

const API_URL = process.env.SOCCER_MATCHES_API_URL;

let latestData = [];
let isFetching = false; // Flag to prevent overlapping requests

const fetchSoccerData = async () => {
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
      console.error('Soccer API error: Request timeout - API took longer than 15 seconds');
    } else if (error.response) {
      console.error('Soccer API error: Server responded with status', error.response.status);
    } else if (error.request) {
      console.error('Soccer API error: No response received from server');
    } else {
      console.error('Soccer API error:', error.message);
    }
    // Return cached data if available instead of null
    return latestData.length > 0 ? latestData : null;
  } finally {
    isFetching = false; // Reset flag when request completes
  }
};

const getLatestSoccerData = () => latestData;

module.exports = {
  fetchSoccerData,
  getLatestSoccerData,
};

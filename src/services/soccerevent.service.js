const axios = require('axios');

const API_URL = 'http://172.232.74.157/getdata';

// Store data per event ID
const soccerEventDataCache = new Map();
// Track fetching state per event ID
const fetchingStates = new Map();

const fetchSoccerEventData = async (eventId) => {
  if (!eventId) {
    console.error('Soccer event API error: eventId is required');
    return null;
  }

  // If a request for this event is already in progress, skip this call
  if (fetchingStates.get(eventId)) {
    return soccerEventDataCache.get(eventId) || null;
  }

  fetchingStates.set(eventId, true);

  try {
    const response = await axios.get(`${API_URL}?eventId=${eventId}`, {
      timeout: 15000, // Increased to 15 seconds
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    });

    const data = response.data;
    soccerEventDataCache.set(eventId, data);
    return data;
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      console.error(`Soccer event API error (eventId: ${eventId}): Request timeout - API took longer than 15 seconds`);
    } else if (error.response) {
      console.error(`Soccer event API error (eventId: ${eventId}): Server responded with status`, error.response.status);
    } else if (error.request) {
      console.error(`Soccer event API error (eventId: ${eventId}): No response received from server`);
    } else {
      console.error(`Soccer event API error (eventId: ${eventId}):`, error.message);
    }
    // Return cached data if available for this event
    return soccerEventDataCache.get(eventId) || null;
  } finally {
    fetchingStates.set(eventId, false); // Reset flag when request completes
  }
};

const getLatestSoccerEventData = (eventId = null) => {
  if (eventId) {
    return soccerEventDataCache.get(eventId) || null;
  }
  // If no eventId specified, return all cached data (for backward compatibility)
  const allData = Array.from(soccerEventDataCache.values());
  return allData.length > 0 ? allData.flat() : null;
};

module.exports = {
  fetchSoccerEventData,
  getLatestSoccerEventData,
};

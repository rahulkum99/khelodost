const {
  fetchSoccerEventData,
  getLatestSoccerEventData,
} = require('../services/soccerevent.service');
const API_REFRESH_TIME = parseInt(process.env.API_REFRESH_TIME) || 400;

module.exports = (io) => {
  console.log('⚡ Soccer event socket initialized');

  // Store active event IDs and their polling intervals
  const activeEventIntervals = new Map();
  // Track subscribers per event ID (Set of socket IDs)
  const eventSubscribers = new Map();

  // Function to get subscriber count for an event
  const getSubscriberCount = (eventId) => {
    return eventSubscribers.get(eventId)?.size || 0;
  };

  // Helper to ensure we only send MATCH_ODDS markets
  const filterMatchOddsMarkets = (data) => {
    if (Array.isArray(data)) {
      return data.filter((item) => item && item.mname === 'MATCH_ODDS');
    }

    if (data && typeof data === 'object') {
      return data.mname === 'MATCH_ODDS' ? data : null;
    }

    return data;
  };

  // Function to add a subscriber to an event
  const addSubscriber = (eventId, socketId) => {
    if (!eventSubscribers.has(eventId)) {
      eventSubscribers.set(eventId, new Set());
    }
    eventSubscribers.get(eventId).add(socketId);
  };

  // Function to remove a subscriber from an event
  const removeSubscriber = (eventId, socketId) => {
    const subscribers = eventSubscribers.get(eventId);
    if (subscribers) {
      subscribers.delete(socketId);
      // If no more subscribers, remove the Set
      if (subscribers.size === 0) {
        eventSubscribers.delete(eventId);
      }
    }
  };

  // Function to start polling for a specific event ID
  const startPollingEvent = (eventId) => {
    // If already polling this event, skip
    if (activeEventIntervals.has(eventId)) {
      return;
    }

    console.log(`🔄 Starting to poll soccer event: ${eventId}`);

    // Poll API every 400ms for this specific event
    const intervalId = setInterval(async () => {
      // Check if there are still subscribers before fetching
      const subscriberCount = getSubscriberCount(eventId);
      if (subscriberCount === 0) {
        stopPollingEvent(eventId);
        return;
      }

      try {
        const rawData = await fetchSoccerEventData(eventId);
        const data = filterMatchOddsMarkets(rawData);
        // Check if data exists after filtering (could be array or object)
        if (data !== null && data !== undefined) {
          // Emit to ALL connected users subscribed to this event
          io.emit(`soccer_event_${eventId}`, data);
          const dataLength = Array.isArray(data) ? data.length : (typeof data === 'object' ? 'object' : 'data');
          console.log(`📡 Broadcasted soccer MATCH_ODDS data for event ${eventId} (${dataLength}) to ${subscriberCount} subscriber(s)`);
        } else {
          console.log(`⚠️ No MATCH_ODDS data received for event ${eventId} (subscribers: ${subscriberCount}), skipping broadcast`);
        }
      } catch (error) {
        console.error(`❌ Error polling soccer event ${eventId}:`, error.message);
        // Still try to send cached data if available
        const cached = getLatestSoccerEventData(eventId);
        const filteredCached = filterMatchOddsMarkets(cached);
        if (filteredCached !== null && filteredCached !== undefined) {
          io.emit(`soccer_event_${eventId}`, filteredCached);
          console.log(`📡 Sent cached MATCH_ODDS data for event ${eventId} due to error`);
        }
      }
    }, API_REFRESH_TIME);

    activeEventIntervals.set(eventId, intervalId);
  };

  // Function to stop polling for a specific event ID
  const stopPollingEvent = (eventId) => {
    const intervalId = activeEventIntervals.get(eventId);
    if (intervalId) {
      clearInterval(intervalId);
      activeEventIntervals.delete(eventId);
      console.log(`⏹️ Stopped polling soccer event: ${eventId} (no active subscribers)`);
    }
  };

  // Function to cleanup all subscriptions for a socket
  const cleanupSocketSubscriptions = (socketId) => {
    const eventsToCheck = Array.from(eventSubscribers.keys());
    
    eventsToCheck.forEach(eventId => {
      if (eventSubscribers.get(eventId)?.has(socketId)) {
        removeSubscriber(eventId, socketId);
        
        // If no more subscribers, stop polling
        if (getSubscriberCount(eventId) === 0) {
          stopPollingEvent(eventId);
        }
      }
    });
  };

  io.on('connection', (socket) => {
    console.log(`✅ User connected: ${socket.id}`);

    // Initialize socket's event subscriptions tracking
    socket.eventIds = new Set();

    // Handle client subscribing to a specific event ID
    socket.on('subscribe_soccer_event', (eventId) => {
      // Validate eventId
      if (!eventId || typeof eventId !== 'string') {
        socket.emit('error', { 
          message: 'Invalid event ID. Event ID must be a non-empty string.',
          event: 'subscribe_soccer_event'
        });
        console.warn(`⚠️ Invalid subscription attempt from ${socket.id}: invalid eventId`);
        return;
      }

      // Check if already subscribed
      if (socket.eventIds.has(eventId)) {
        console.log(`ℹ️ User ${socket.id} already subscribed to soccer event: ${eventId}`);
        // Still send cached data
        const cached = getLatestSoccerEventData(eventId);
        if (cached !== null && cached !== undefined) {
          socket.emit(`soccer_event_${eventId}`, cached);
          console.log(`📤 Resent cached data for event ${eventId} to user: ${socket.id}`);
        }
        return;
      }

      console.log(`📥 User ${socket.id} subscribed to soccer event: ${eventId}`);
      
      // Add to subscriber tracking
      addSubscriber(eventId, socket.id);
      socket.eventIds.add(eventId);
      
      // Start polling if not already started
      startPollingEvent(eventId);
      
      // Send cached data immediately if available for this event
      const cached = getLatestSoccerEventData(eventId);
      if (cached !== null && cached !== undefined) {
        socket.emit(`soccer_event_${eventId}`, cached);
        const cachedLength = Array.isArray(cached) ? cached.length : 'object';
        console.log(`📤 Sent cached data for event ${eventId} (${cachedLength} items) to user: ${socket.id}`);
      } else {
        // Notify that subscription was successful but no cached data available
        socket.emit(`soccer_event_${eventId}_subscribed`, { 
          eventId, 
          message: 'Subscribed successfully. Waiting for data...' 
        });
        console.log(`📤 Subscription confirmed for event ${eventId} to user: ${socket.id} (no cached data yet)`);
      }
    });

    // Handle client unsubscribing from a specific event ID
    socket.on('unsubscribe_soccer_event', (eventId) => {
      if (!eventId) {
        socket.emit('error', { 
          message: 'Event ID is required for unsubscription.',
          event: 'unsubscribe_soccer_event'
        });
        return;
      }

      if (!socket.eventIds.has(eventId)) {
        console.warn(`⚠️ User ${socket.id} tried to unsubscribe from event ${eventId} but was not subscribed`);
        return;
      }

      console.log(`📤 User ${socket.id} unsubscribed from soccer event: ${eventId}`);
      
      // Remove from tracking
      removeSubscriber(eventId, socket.id);
      socket.eventIds.delete(eventId);
      
      // Remove event listener for this specific event
      socket.removeAllListeners(`soccer_event_${eventId}`);
      
      // If no more subscribers, stop polling
      if (getSubscriberCount(eventId) === 0) {
        stopPollingEvent(eventId);
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`❌ User disconnected: ${socket.id}`);
      
      // Clean up all subscriptions for this socket
      cleanupSocketSubscriptions(socket.id);
      
      // Clear socket's event IDs
      if (socket.eventIds) {
        socket.eventIds.clear();
      }
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`❌ Socket error for ${socket.id}:`, error);
    });
  });

  // Graceful shutdown handler
  process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, cleaning up soccer event sockets...');
    activeEventIntervals.forEach((intervalId, eventId) => {
      clearInterval(intervalId);
      console.log(`⏹️ Stopped polling event: ${eventId}`);
    });
    activeEventIntervals.clear();
    eventSubscribers.clear();
  });
};

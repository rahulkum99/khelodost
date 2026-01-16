# Frontend Implementation Guide for Event Sockets

This guide shows how to implement the Socket.IO event system in your frontend application.

## Backend Overview

- **Server URL**: `http://localhost:5000` (or your server URL)
- **Polling Interval**: 400ms
- **Data Format**: Full API response with `{success, msg, status, data: [...]}`

## Available Events

### Cricket Events
- **Subscribe**: `subscribe_cricket_event` (eventId: string)
- **Listen**: `cricket_event_{eventId}`
- **Unsubscribe**: `unsubscribe_cricket_event` (eventId: string)

### Soccer Events
- **Subscribe**: `subscribe_soccer_event` (eventId: string)
- **Listen**: `soccer_event_{eventId}`
- **Unsubscribe**: `unsubscribe_soccer_event` (eventId: string)

### Tennis Events
- **Subscribe**: `subscribe_tennis_event` (eventId: string)
- **Listen**: `tennis_event_{eventId}`
- **Unsubscribe**: `unsubscribe_tennis_event` (eventId: string)

## Response Data Structure

```typescript
interface EventResponse {
  success: boolean;
  msg: string;
  status: number;
  data: Array<{
    gmid: string;
    mid: number;
    pmid: number | null;
    mname: string;
    rem: string;
    gtype: string;
    status: string;
    // ... more fields
    section: Array<{
      sid: number;
      nat: string;
      odds: Array<{
        odds: number;
        otype: string;
        oname: string;
        size: number;
      }>;
    }>;
  }>;
}
```

---

## 1. Vanilla JavaScript Implementation

### HTML

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Event Socket Test</title>
  <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
</head>
<body>
  <div id="app">
    <h1>Event Socket Test</h1>
    
    <div>
      <label>Event ID:</label>
      <input type="text" id="eventId" value="712121462" placeholder="Enter event ID">
    </div>
    
    <div>
      <button onclick="subscribeCricket()">Subscribe Cricket</button>
      <button onclick="subscribeSoccer()">Subscribe Soccer</button>
      <button onclick="subscribeTennis()">Subscribe Tennis</button>
      <button onclick="unsubscribe()">Unsubscribe</button>
    </div>
    
    <div>
      <h3>Connection Status: <span id="status">Disconnected</span></h3>
      <h3>Subscribed Events: <span id="subscribed">None</span></h3>
    </div>
    
    <div>
      <h3>Event Data:</h3>
      <pre id="output"></pre>
    </div>
  </div>

  <script>
    // Initialize Socket.IO connection
    const SOCKET_URL = 'http://localhost:5000';
    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    const output = document.getElementById('output');
    const statusEl = document.getElementById('status');
    const subscribedEl = document.getElementById('subscribed');
    
    let subscribedEvents = new Set();

    // Connection handlers
    socket.on('connect', () => {
      console.log('✅ Connected:', socket.id);
      statusEl.textContent = 'Connected';
      statusEl.style.color = 'green';
    });

    socket.on('disconnect', () => {
      console.log('❌ Disconnected');
      statusEl.textContent = 'Disconnected';
      statusEl.style.color = 'red';
    });

    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      statusEl.textContent = 'Connection Error';
      statusEl.style.color = 'red';
    });

    // Error handler
    socket.on('error', (error) => {
      console.error('Socket error:', error);
      log(`Error: ${error.message || JSON.stringify(error)}`);
    });

    // Cricket Event Functions
    function subscribeCricket() {
      const eventId = document.getElementById('eventId').value;
      if (!eventId) {
        alert('Please enter an event ID');
        return;
      }

      // Subscribe to event
      socket.emit('subscribe_cricket_event', eventId);
      subscribedEvents.add(`cricket_${eventId}`);
      updateSubscribedList();

      // Listen for data
      const eventName = `cricket_event_${eventId}`;
      socket.on(eventName, (data) => {
        log(`Cricket Event ${eventId}:`, data);
        // Process your data here
        if (data && data.success && data.data) {
          processEventData(data.data, 'cricket');
        }
      });

      // Listen for subscription confirmation
      socket.on(`${eventName}_subscribed`, (data) => {
        log(`Subscribed to cricket event ${eventId}:`, data);
      });

      log(`Subscribed to cricket event: ${eventId}`);
    }

    // Soccer Event Functions
    function subscribeSoccer() {
      const eventId = document.getElementById('eventId').value;
      if (!eventId) {
        alert('Please enter an event ID');
        return;
      }

      socket.emit('subscribe_soccer_event', eventId);
      subscribedEvents.add(`soccer_${eventId}`);
      updateSubscribedList();

      const eventName = `soccer_event_${eventId}`;
      socket.on(eventName, (data) => {
        log(`Soccer Event ${eventId}:`, data);
        if (data && data.success && data.data) {
          processEventData(data.data, 'soccer');
        }
      });

      socket.on(`${eventName}_subscribed`, (data) => {
        log(`Subscribed to soccer event ${eventId}:`, data);
      });

      log(`Subscribed to soccer event: ${eventId}`);
    }

    // Tennis Event Functions
    function subscribeTennis() {
      const eventId = document.getElementById('eventId').value;
      if (!eventId) {
        alert('Please enter an event ID');
        return;
      }

      socket.emit('subscribe_tennis_event', eventId);
      subscribedEvents.add(`tennis_${eventId}`);
      updateSubscribedList();

      const eventName = `tennis_event_${eventId}`;
      socket.on(eventName, (data) => {
        log(`Tennis Event ${eventId}:`, data);
        if (data && data.success && data.data) {
          processEventData(data.data, 'tennis');
        }
      });

      socket.on(`${eventName}_subscribed`, (data) => {
        log(`Subscribed to tennis event ${eventId}:`, data);
      });

      log(`Subscribed to tennis event: ${eventId}`);
    }

    // Unsubscribe function
    function unsubscribe() {
      const eventId = document.getElementById('eventId').value;
      if (!eventId) {
        alert('Please enter an event ID');
        return;
      }

      // Unsubscribe from all event types
      socket.emit('unsubscribe_cricket_event', eventId);
      socket.emit('unsubscribe_soccer_event', eventId);
      socket.emit('unsubscribe_tennis_event', eventId);

      // Remove listeners
      socket.removeAllListeners(`cricket_event_${eventId}`);
      socket.removeAllListeners(`soccer_event_${eventId}`);
      socket.removeAllListeners(`tennis_event_${eventId}`);

      subscribedEvents.delete(`cricket_${eventId}`);
      subscribedEvents.delete(`soccer_${eventId}`);
      subscribedEvents.delete(`tennis_${eventId}`);
      updateSubscribedList();

      log(`Unsubscribed from event: ${eventId}`);
    }

    // Helper functions
    function log(message, data = null) {
      const timestamp = new Date().toLocaleTimeString();
      const logMessage = `[${timestamp}] ${message}`;
      console.log(logMessage, data || '');
      
      if (data) {
        output.textContent += `${logMessage}\n${JSON.stringify(data, null, 2)}\n\n`;
      } else {
        output.textContent += `${logMessage}\n`;
      }
      output.scrollTop = output.scrollHeight;
    }

    function updateSubscribedList() {
      const list = Array.from(subscribedEvents).join(', ') || 'None';
      subscribedEl.textContent = list;
    }

    function processEventData(dataArray, sportType) {
      // Process the event data array
      dataArray.forEach((market) => {
        console.log(`${sportType} Market:`, market.mname, market.status);
        // Update your UI here
      });
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      socket.disconnect();
    });
  </script>
</body>
</html>
```

---

## 2. React Implementation

### Install Dependencies

```bash
npm install socket.io-client
```

### Hook: `useEventSocket.js`

```javascript
import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

export const useEventSocket = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [socketId, setSocketId] = useState(null);
  const socketRef = useRef(null);
  const subscriptionsRef = useRef(new Set());

  useEffect(() => {
    // Initialize socket connection
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    const socket = socketRef.current;

    // Connection handlers
    socket.on('connect', () => {
      console.log('✅ Socket connected:', socket.id);
      setIsConnected(true);
      setSocketId(socket.id);
    });

    socket.on('disconnect', () => {
      console.log('❌ Socket disconnected');
      setIsConnected(false);
      setSocketId(null);
    });

    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setIsConnected(false);
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    // Cleanup on unmount
    return () => {
      socket.disconnect();
    };
  }, []);

  // Subscribe to cricket event
  const subscribeCricketEvent = useCallback((eventId, onData) => {
    if (!socketRef.current || !eventId) return;

    const subscriptionKey = `cricket_${eventId}`;
    if (subscriptionsRef.current.has(subscriptionKey)) {
      console.warn(`Already subscribed to cricket event: ${eventId}`);
      return;
    }

    const socket = socketRef.current;
    const eventName = `cricket_event_${eventId}`;

    // Subscribe
    socket.emit('subscribe_cricket_event', eventId);
    subscriptionsRef.current.add(subscriptionKey);

    // Listen for data
    socket.on(eventName, (data) => {
      if (data && data.success && data.data) {
        onData(data.data, data);
      } else {
        onData(null, data);
      }
    });

    // Listen for subscription confirmation
    socket.on(`${eventName}_subscribed`, (data) => {
      console.log(`Subscribed to cricket event ${eventId}:`, data);
    });

    return () => {
      unsubscribeCricketEvent(eventId);
    };
  }, []);

  // Subscribe to soccer event
  const subscribeSoccerEvent = useCallback((eventId, onData) => {
    if (!socketRef.current || !eventId) return;

    const subscriptionKey = `soccer_${eventId}`;
    if (subscriptionsRef.current.has(subscriptionKey)) {
      console.warn(`Already subscribed to soccer event: ${eventId}`);
      return;
    }

    const socket = socketRef.current;
    const eventName = `soccer_event_${eventId}`;

    socket.emit('subscribe_soccer_event', eventId);
    subscriptionsRef.current.add(subscriptionKey);

    socket.on(eventName, (data) => {
      if (data && data.success && data.data) {
        onData(data.data, data);
      } else {
        onData(null, data);
      }
    });

    socket.on(`${eventName}_subscribed`, (data) => {
      console.log(`Subscribed to soccer event ${eventId}:`, data);
    });

    return () => {
      unsubscribeSoccerEvent(eventId);
    };
  }, []);

  // Subscribe to tennis event
  const subscribeTennisEvent = useCallback((eventId, onData) => {
    if (!socketRef.current || !eventId) return;

    const subscriptionKey = `tennis_${eventId}`;
    if (subscriptionsRef.current.has(subscriptionKey)) {
      console.warn(`Already subscribed to tennis event: ${eventId}`);
      return;
    }

    const socket = socketRef.current;
    const eventName = `tennis_event_${eventId}`;

    socket.emit('subscribe_tennis_event', eventId);
    subscriptionsRef.current.add(subscriptionKey);

    socket.on(eventName, (data) => {
      if (data && data.success && data.data) {
        onData(data.data, data);
      } else {
        onData(null, data);
      }
    });

    socket.on(`${eventName}_subscribed`, (data) => {
      console.log(`Subscribed to tennis event ${eventId}:`, data);
    });

    return () => {
      unsubscribeTennisEvent(eventId);
    };
  }, []);

  // Unsubscribe functions
  const unsubscribeCricketEvent = useCallback((eventId) => {
    if (!socketRef.current || !eventId) return;

    const socket = socketRef.current;
    const subscriptionKey = `cricket_${eventId}`;
    const eventName = `cricket_event_${eventId}`;

    socket.emit('unsubscribe_cricket_event', eventId);
    socket.removeAllListeners(eventName);
    socket.removeAllListeners(`${eventName}_subscribed`);
    subscriptionsRef.current.delete(subscriptionKey);
  }, []);

  const unsubscribeSoccerEvent = useCallback((eventId) => {
    if (!socketRef.current || !eventId) return;

    const socket = socketRef.current;
    const subscriptionKey = `soccer_${eventId}`;
    const eventName = `soccer_event_${eventId}`;

    socket.emit('unsubscribe_soccer_event', eventId);
    socket.removeAllListeners(eventName);
    socket.removeAllListeners(`${eventName}_subscribed`);
    subscriptionsRef.current.delete(subscriptionKey);
  }, []);

  const unsubscribeTennisEvent = useCallback((eventId) => {
    if (!socketRef.current || !eventId) return;

    const socket = socketRef.current;
    const subscriptionKey = `tennis_${eventId}`;
    const eventName = `tennis_event_${eventId}`;

    socket.emit('unsubscribe_tennis_event', eventId);
    socket.removeAllListeners(eventName);
    socket.removeAllListeners(`${eventName}_subscribed`);
    subscriptionsRef.current.delete(subscriptionKey);
  }, []);

  return {
    isConnected,
    socketId,
    subscribeCricketEvent,
    subscribeSoccerEvent,
    subscribeTennisEvent,
    unsubscribeCricketEvent,
    unsubscribeSoccerEvent,
    unsubscribeTennisEvent,
  };
};
```

### Component: `EventViewer.jsx`

```jsx
import React, { useState, useEffect } from 'react';
import { useEventSocket } from './hooks/useEventSocket';

const EventViewer = ({ eventId, sportType = 'cricket' }) => {
  const [eventData, setEventData] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const {
    isConnected,
    subscribeCricketEvent,
    subscribeSoccerEvent,
    subscribeTennisEvent,
    unsubscribeCricketEvent,
    unsubscribeSoccerEvent,
    unsubscribeTennisEvent,
  } = useEventSocket();

  useEffect(() => {
    if (!eventId || !isConnected) return;

    const handleData = (dataArray, fullResponse) => {
      setEventData(dataArray);
      setLastUpdate(new Date());
    };

    let unsubscribe;

    switch (sportType) {
      case 'cricket':
        unsubscribe = subscribeCricketEvent(eventId, handleData);
        break;
      case 'soccer':
        unsubscribe = subscribeSoccerEvent(eventId, handleData);
        break;
      case 'tennis':
        unsubscribe = subscribeTennisEvent(eventId, handleData);
        break;
      default:
        unsubscribe = subscribeCricketEvent(eventId, handleData);
    }

    return () => {
      if (unsubscribe) unsubscribe();
      switch (sportType) {
        case 'cricket':
          unsubscribeCricketEvent(eventId);
          break;
        case 'soccer':
          unsubscribeSoccerEvent(eventId);
          break;
        case 'tennis':
          unsubscribeTennisEvent(eventId);
          break;
      }
    };
  }, [eventId, sportType, isConnected]);

  if (!isConnected) {
    return <div>Connecting to server...</div>;
  }

  if (!eventData) {
    return <div>Waiting for event data...</div>;
  }

  return (
    <div>
      <div>
        <strong>Status:</strong> {isConnected ? '✅ Connected' : '❌ Disconnected'}
        {lastUpdate && (
          <span style={{ marginLeft: '20px' }}>
            Last update: {lastUpdate.toLocaleTimeString()}
          </span>
        )}
      </div>

      <div>
        <h3>Event Markets ({eventData.length})</h3>
        {eventData.map((market, index) => (
          <div key={index} style={{ marginBottom: '20px', padding: '10px', border: '1px solid #ccc' }}>
            <h4>{market.mname}</h4>
            <p>Status: {market.status}</p>
            <p>Type: {market.gtype}</p>
            {market.section && market.section.length > 0 && (
              <div>
                <strong>Sections:</strong>
                {market.section.map((section, sIndex) => (
                  <div key={sIndex} style={{ marginLeft: '20px', marginTop: '10px' }}>
                    <p>{section.nat}</p>
                    {section.odds && section.odds.length > 0 && (
                      <div>
                        {section.odds.map((odd, oIndex) => (
                          <span key={oIndex} style={{ marginRight: '10px' }}>
                            {odd.oname}: {odd.odds} (Size: {odd.size})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default EventViewer;
```

### Usage Example

```jsx
import React, { useState } from 'react';
import EventViewer from './components/EventViewer';

function App() {
  const [eventId, setEventId] = useState('712121462');
  const [sportType, setSportType] = useState('cricket');

  return (
    <div>
      <h1>Event Socket Test</h1>
      <div>
        <label>
          Event ID:
          <input
            type="text"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          />
        </label>
      </div>
      <div>
        <label>
          Sport Type:
          <select value={sportType} onChange={(e) => setSportType(e.target.value)}>
            <option value="cricket">Cricket</option>
            <option value="soccer">Soccer</option>
            <option value="tennis">Tennis</option>
          </select>
        </label>
      </div>
      <EventViewer eventId={eventId} sportType={sportType} />
    </div>
  );
}

export default App;
```

---

## 3. Vue 3 Implementation

### Install Dependencies

```bash
npm install socket.io-client
```

### Composable: `useEventSocket.js`

```javascript
import { ref, onMounted, onUnmounted } from 'vue';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

export function useEventSocket() {
  const isConnected = ref(false);
  const socketId = ref(null);
  let socket = null;
  const subscriptions = new Set();

  onMounted(() => {
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
      console.log('✅ Socket connected:', socket.id);
      isConnected.value = true;
      socketId.value = socket.id;
    });

    socket.on('disconnect', () => {
      console.log('❌ Socket disconnected');
      isConnected.value = false;
      socketId.value = null;
    });

    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      isConnected.value = false;
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  onUnmounted(() => {
    if (socket) {
      socket.disconnect();
    }
  });

  const subscribeCricketEvent = (eventId, onData) => {
    if (!socket || !eventId) return;

    const subscriptionKey = `cricket_${eventId}`;
    if (subscriptions.has(subscriptionKey)) {
      console.warn(`Already subscribed to cricket event: ${eventId}`);
      return;
    }

    const eventName = `cricket_event_${eventId}`;
    socket.emit('subscribe_cricket_event', eventId);
    subscriptions.add(subscriptionKey);

    socket.on(eventName, (data) => {
      if (data && data.success && data.data) {
        onData(data.data, data);
      } else {
        onData(null, data);
      }
    });

    socket.on(`${eventName}_subscribed`, (data) => {
      console.log(`Subscribed to cricket event ${eventId}:`, data);
    });

    return () => unsubscribeCricketEvent(eventId);
  };

  const subscribeSoccerEvent = (eventId, onData) => {
    if (!socket || !eventId) return;

    const subscriptionKey = `soccer_${eventId}`;
    if (subscriptions.has(subscriptionKey)) {
      console.warn(`Already subscribed to soccer event: ${eventId}`);
      return;
    }

    const eventName = `soccer_event_${eventId}`;
    socket.emit('subscribe_soccer_event', eventId);
    subscriptions.add(subscriptionKey);

    socket.on(eventName, (data) => {
      if (data && data.success && data.data) {
        onData(data.data, data);
      } else {
        onData(null, data);
      }
    });

    return () => unsubscribeSoccerEvent(eventId);
  };

  const subscribeTennisEvent = (eventId, onData) => {
    if (!socket || !eventId) return;

    const subscriptionKey = `tennis_${eventId}`;
    if (subscriptions.has(subscriptionKey)) {
      console.warn(`Already subscribed to tennis event: ${eventId}`);
      return;
    }

    const eventName = `tennis_event_${eventId}`;
    socket.emit('subscribe_tennis_event', eventId);
    subscriptions.add(subscriptionKey);

    socket.on(eventName, (data) => {
      if (data && data.success && data.data) {
        onData(data.data, data);
      } else {
        onData(null, data);
      }
    });

    return () => unsubscribeTennisEvent(eventId);
  };

  const unsubscribeCricketEvent = (eventId) => {
    if (!socket || !eventId) return;
    const eventName = `cricket_event_${eventId}`;
    socket.emit('unsubscribe_cricket_event', eventId);
    socket.removeAllListeners(eventName);
    socket.removeAllListeners(`${eventName}_subscribed`);
    subscriptions.delete(`cricket_${eventId}`);
  };

  const unsubscribeSoccerEvent = (eventId) => {
    if (!socket || !eventId) return;
    const eventName = `soccer_event_${eventId}`;
    socket.emit('unsubscribe_soccer_event', eventId);
    socket.removeAllListeners(eventName);
    socket.removeAllListeners(`${eventName}_subscribed`);
    subscriptions.delete(`soccer_${eventId}`);
  };

  const unsubscribeTennisEvent = (eventId) => {
    if (!socket || !eventId) return;
    const eventName = `tennis_event_${eventId}`;
    socket.emit('unsubscribe_tennis_event', eventId);
    socket.removeAllListeners(eventName);
    socket.removeAllListeners(`${eventName}_subscribed`);
    subscriptions.delete(`tennis_${eventId}`);
  };

  return {
    isConnected,
    socketId,
    subscribeCricketEvent,
    subscribeSoccerEvent,
    subscribeTennisEvent,
    unsubscribeCricketEvent,
    unsubscribeSoccerEvent,
    unsubscribeTennisEvent,
  };
}
```

### Component: `EventViewer.vue`

```vue
<template>
  <div>
    <div>
      <strong>Status:</strong> 
      <span :class="{ connected: isConnected, disconnected: !isConnected }">
        {{ isConnected ? '✅ Connected' : '❌ Disconnected' }}
      </span>
      <span v-if="lastUpdate" style="margin-left: 20px">
        Last update: {{ formatTime(lastUpdate) }}
      </span>
    </div>

    <div v-if="!isConnected">
      Connecting to server...
    </div>

    <div v-else-if="!eventData">
      Waiting for event data...
    </div>

    <div v-else>
      <h3>Event Markets ({{ eventData.length }})</h3>
      <div v-for="(market, index) in eventData" :key="index" class="market-card">
        <h4>{{ market.mname }}</h4>
        <p>Status: {{ market.status }}</p>
        <p>Type: {{ market.gtype }}</p>
        <div v-if="market.section && market.section.length > 0">
          <strong>Sections:</strong>
          <div v-for="(section, sIndex) in market.section" :key="sIndex" class="section">
            <p>{{ section.nat }}</p>
            <div v-if="section.odds && section.odds.length > 0">
              <span
                v-for="(odd, oIndex) in section.odds"
                :key="oIndex"
                class="odd"
              >
                {{ odd.oname }}: {{ odd.odds }} (Size: {{ odd.size }})
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue';
import { useEventSocket } from '../composables/useEventSocket';

const props = defineProps({
  eventId: {
    type: String,
    required: true,
  },
  sportType: {
    type: String,
    default: 'cricket',
    validator: (value) => ['cricket', 'soccer', 'tennis'].includes(value),
  },
});

const eventData = ref(null);
const lastUpdate = ref(null);

const {
  isConnected,
  subscribeCricketEvent,
  subscribeSoccerEvent,
  subscribeTennisEvent,
  unsubscribeCricketEvent,
  unsubscribeSoccerEvent,
  unsubscribeTennisEvent,
} = useEventSocket();

let unsubscribe = null;

watch(
  [() => props.eventId, () => props.sportType, isConnected],
  ([eventId, sportType, connected]) => {
    if (!eventId || !connected) return;

    const handleData = (dataArray, fullResponse) => {
      eventData.value = dataArray;
      lastUpdate.value = new Date();
    };

    // Cleanup previous subscription
    if (unsubscribe) {
      unsubscribe();
    }

    switch (sportType) {
      case 'cricket':
        unsubscribe = subscribeCricketEvent(eventId, handleData);
        break;
      case 'soccer':
        unsubscribe = subscribeSoccerEvent(eventId, handleData);
        break;
      case 'tennis':
        unsubscribe = subscribeTennisEvent(eventId, handleData);
        break;
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe();
  }
  switch (props.sportType) {
    case 'cricket':
      unsubscribeCricketEvent(props.eventId);
      break;
    case 'soccer':
      unsubscribeSoccerEvent(props.eventId);
      break;
    case 'tennis':
      unsubscribeTennisEvent(props.eventId);
      break;
  }
});

const formatTime = (date) => {
  return new Date(date).toLocaleTimeString();
};
</script>

<style scoped>
.market-card {
  margin-bottom: 20px;
  padding: 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.section {
  margin-left: 20px;
  margin-top: 10px;
}

.odd {
  margin-right: 10px;
}

.connected {
  color: green;
}

.disconnected {
  color: red;
}
</style>
```

---

## 4. TypeScript Types

Create `types/event.ts`:

```typescript
export interface EventResponse {
  success: boolean;
  msg: string;
  status: number;
  data: Market[];
}

export interface Market {
  gmid: string;
  mid: number;
  pmid: number | null;
  mname: string;
  rem: string;
  gtype: string;
  status: string;
  rc: number;
  visible: boolean;
  pid: number;
  gscode: number;
  maxb: number;
  sno: number;
  dtype: number;
  ocnt: number;
  m: number;
  max: number;
  min: number;
  biplay: boolean;
  umaxbof: number;
  boplay: boolean;
  iplay: boolean;
  btcnt: number;
  company: string | null;
  section: Section[];
}

export interface Section {
  sid: number;
  psid: number;
  sno: number;
  psrno: number;
  gstatus: string;
  nat: string;
  gscode: number;
  max: number;
  min: number;
  rem: string;
  br: boolean;
  rname: string | null;
  jname: string | null;
  tname: string | null;
  hage: number;
  himg: string | null;
  adfa: number;
  rdt: string | null;
  cno: string | null;
  sdraw: string | null;
  ik: number;
  ikm: number;
  odds: Odd[];
}

export interface Odd {
  psid: number;
  odds: number;
  otype: 'back' | 'lay';
  oname: string;
  tno: number;
  size: number;
}

export type SportType = 'cricket' | 'soccer' | 'tennis';
```

---

## Testing Checklist

- [ ] Socket connects successfully
- [ ] Can subscribe to cricket events
- [ ] Can subscribe to soccer events
- [ ] Can subscribe to tennis events
- [ ] Receives data updates every 400ms
- [ ] Receives cached data immediately on subscription
- [ ] Can unsubscribe from events
- [ ] Handles connection errors gracefully
- [ ] Cleans up subscriptions on component unmount
- [ ] Handles multiple event subscriptions simultaneously

---

## Troubleshooting

### Connection Issues
- Check server URL is correct
- Ensure CORS is configured on backend
- Check firewall/network settings

### No Data Received
- Verify event ID exists in fixture API
- Check server console for errors
- Ensure subscription was successful

### Performance Issues
- Limit number of simultaneous subscriptions
- Implement data throttling/debouncing if needed
- Use React.memo or Vue computed for expensive renders

---

## Best Practices

1. **Always unsubscribe** when component unmounts
2. **Handle connection errors** gracefully
3. **Validate event IDs** before subscribing
4. **Cache data locally** if needed for offline support
5. **Debounce UI updates** if rendering is expensive
6. **Monitor subscription count** to avoid memory leaks
7. **Use TypeScript** for type safety
8. **Implement reconnection logic** for production

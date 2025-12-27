require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');

const app = require('./app');

const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Attach socket.io
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

// Load socket handlers
require('./sockets/cricket.socket')(io);
require('./sockets/cricketevent.socket')(io);
require('./sockets/soccer.socket')(io);
require('./sockets/soccerevent.socket')(io);
require('./sockets/tennis.socket')(io);
require('./sockets/tennisevent.socket')(io);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

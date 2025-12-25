const {
  fetchSoccerData,
  getLatestSoccerData,
} = require('../services/soccer.service');

module.exports = (io) => {
  console.log('⚡ Soccer socket initialized');

  // Poll API every 400ms - ensures only one call at a time
  // If previous call is still in progress, it will be skipped
  setInterval(async () => {
    const data = await fetchSoccerData();
    if (data && data.length > 0) {
      // Emit to ALL connected users instantly
      io.emit('soccer_matches', data);
      console.log(`📡 Broadcasted soccer data to all users (${data.length} matches)`);
    }
  }, 400);

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Send last cached data immediately to new user
    const cached = getLatestSoccerData();
    if (cached && cached.length > 0) {
      socket.emit('soccer_matches', cached);
      console.log(`📤 Sent cached data to new user: ${socket.id}`);
    }

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
    });
  });
};

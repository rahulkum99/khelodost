const {
    fetchTennisData,
    getLatestTennisData,
  } = require('../services/tennis.service');
  
  module.exports = (io) => {
    console.log('⚡ Tennis socket initialized');
  
    // Poll API every 400ms - ensures only one call at a time
    // If previous call is still in progress, it will be skipped
    setInterval(async () => {
      const data = await fetchTennisData();
      if (data && data.length > 0) {
        io.emit('tennis_matches', data);
        console.log(`📡 Broadcasted tennis data to all users (${data.length} matches)`);
      }
    }, 400);
  
    io.on('connection', (socket) => {
      console.log('User connected:', socket.id);
  
      // Send last cached data immediately to new user
      const cached = getLatestTennisData();
      if (cached && cached.length > 0) {
        socket.emit('tennis_matches', cached);
        console.log(`📤 Sent cached data to new user: ${socket.id}`);
      }
  
      socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
      });
    });
  };
const express = require('express');
const router = express.Router();

// Import route modules
const userRoutes = require('../modules/user/user.routes');

// Health check route
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Mount route modules
router.use('/user', userRoutes);

module.exports = router;


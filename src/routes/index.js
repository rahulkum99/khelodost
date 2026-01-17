const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('../modules/auth/auth.routes');
const userRoutes = require('../modules/user/user.routes');
const walletRoutes = require('../modules/wallet/wallet.routes');
const betRoutes = require('../modules/bet/bet.routes');
const marketRoutes = require('../modules/market/market.routes');

// Health check route
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Mount route modules
router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/wallet', walletRoutes);
router.use('/bets', betRoutes);
router.use('/markets', marketRoutes);

module.exports = router;


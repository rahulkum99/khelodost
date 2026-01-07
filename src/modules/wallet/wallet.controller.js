const walletService = require('./wallet.service');
const { validationResult } = require('express-validator');

/**
 * Handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

/**
 * Get wallet for current user
 */
const getMyWallet = async (req, res, next) => {
  try {
    const wallet = await walletService.getWallet(req.userId);
    
    res.json({
      success: true,
      data: { wallet }
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message || 'Wallet not found'
    });
  }
};

/**
 * Get wallet balance for current user
 */
const getMyBalance = async (req, res, next) => {
  try {
    const balance = await walletService.getBalance(req.userId);
    
    res.json({
      success: true,
      data: balance
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message || 'Wallet not found'
    });
  }
};

/**
 * Get wallet for a specific user (admin only)
 */
const getWallet = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const wallet = await walletService.getWallet(userId);
    
    res.json({
      success: true,
      data: { wallet }
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message || 'Wallet not found'
    });
  }
};

/**
 * Add amount to wallet
 */
const addAmount = async (req, res, next) => {
  try {
    const { userId, amount, description } = req.body;
    const result = await walletService.addAmount(
      userId,
      amount,
      req.userId,
      description,
      req
    );
    
    res.json({
      success: true,
      message: 'Amount added successfully',
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to add amount'
    });
  }
};

/**
 * Deduct amount from wallet
 */
const deductAmount = async (req, res, next) => {
  try {
    const { userId, amount, description } = req.body;
    const result = await walletService.deductAmount(
      userId,
      amount,
      req.userId,
      description,
      req
    );
    
    res.json({
      success: true,
      message: 'Amount deducted successfully',
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to deduct amount'
    });
  }
};

/**
 * Transfer amount between wallets
 */
const transferAmount = async (req, res, next) => {
  try {
    // If fromUserId not provided, use current user's wallet
    const fromUserId = req.body.fromUserId || req.userId;
    const { toUserId, amount, description } = req.body;
    
    const result = await walletService.transferAmount(
      fromUserId,
      toUserId,
      amount,
      req.userId,
      description,
      req
    );
    
    res.json({
      success: true,
      message: 'Amount transferred successfully',
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to transfer amount'
    });
  }
};

/**
 * Get wallet transactions
 */
const getTransactions = async (req, res, next) => {
  try {
    const userId = req.params.userId || req.userId;
    const result = await walletService.getTransactions(userId, req.query);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to fetch transactions'
    });
  }
};

/**
 * Lock wallet
 */
const lockWallet = async (req, res, next) => {
  try {
    const { userId, reason } = req.body;
    const wallet = await walletService.lockWallet(userId, req.userId, reason);
    
    res.json({
      success: true,
      message: 'Wallet locked successfully',
      data: { wallet }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to lock wallet'
    });
  }
};

/**
 * Unlock wallet
 */
const unlockWallet = async (req, res, next) => {
  try {
    const { userId } = req.body;
    const wallet = await walletService.unlockWallet(userId, req.userId);
    
    res.json({
      success: true,
      message: 'Wallet unlocked successfully',
      data: { wallet }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to unlock wallet'
    });
  }
};

/**
 * Get wallet statistics
 */
const getWalletStats = async (req, res, next) => {
  try {
    const userId = req.params.userId || req.userId;
    const stats = await walletService.getWalletStats(userId);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to fetch wallet statistics'
    });
  }
};

module.exports = {
  handleValidationErrors,
  getMyWallet,
  getMyBalance,
  getWallet,
  addAmount,
  deductAmount,
  transferAmount,
  getTransactions,
  lockWallet,
  unlockWallet,
  getWalletStats
};


const casinoService = require('./casino.service');
const walletService = require('../wallet/wallet.service');
const spribeGames = require('./casinojson/spribe,games.json');
const inoutGames = require('./casinojson/inout.games.json');
const mac88Games = require('./casinojson/mac88.games.json');





const listSpribeGames =(req, res) => {
  try {
    const result = spribeGames;
    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to list games',
    });
  }
};


const listInoutGames =(req, res) => {
  try {
    const result = inoutGames;
    return res.json({
      success: true,
      data: result,
    });
  }
  catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to list games',
    });
  }
};


const listMac88Games =(req, res) => {
  try {
    const result = mac88Games;
    return res.json({
      success: true,
      data: result,
    });
  }
  catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to list games',
    });
  }
};

const launchGame = async (req, res) => {
  try {
    const wallet = await walletService.getBalance(req.userId);

    const launchUrl = await casinoService.createLaunchUrl({
      userId: req.userId.toString(),
      vendorId: req.query.vendorId || '18',
      gameHash: req.params.gamehash,
      currencyCode: (wallet.currency || req.query.currencyCode || 'inr').toLowerCase(),
      language: req.query.language || 'en',
      creditAmount: Number(wallet.balance || 0),
      platform: req.query.platform || 'web',
    });

    return res.json({
      success: true,
      data: launchUrl,
    });
    // return res.redirect(launchUrl);
  } catch (error) {
    return res.status(500).json({
      message: 'Failed to launch casino game',
      error: error.message,
    });
  }
};


const callbackBet = async (req, res) => {
  try {
    const result = await casinoService.callbackBet(req.body);
    return res.json(result);
  } catch (error) {
    return res.json({
      code: 1,
      message: error.message || 'Failed to callback bet',
      payload: null,
    });
  }
};

module.exports = {
  listSpribeGames,
  listInoutGames,
  listMac88Games,
  launchGame,
  callbackBet,
};

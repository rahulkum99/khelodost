const casinoService = require('./casino.service');
const walletService = require('../wallet/wallet.service');

const launchGame = async (req, res) => {
  try {
    const wallet = await walletService.getBalance(req.userId);

    const launchUrl = await casinoService.createLaunchUrl({
      userId: req.userId.toString(),
      vendorId: req.query.vendorId || '18',
      gameHash: req.query.gameHash || 'a04d1f3eb8ccec8a4823bdf18e3f0e84',
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
  launchGame,
  callbackBet,
};

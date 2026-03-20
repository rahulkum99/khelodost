const casinoService = require('./casino.service');

const getRequiredNumber = (v, name) => {
  const n = Number(v);
  if (Number.isNaN(n)) {
    const err = new Error(`${name} must be a number`);
    err.status = 400;
    throw err;
  }
  return n;
};

const getGameV1 = async (req, res) => {
  try {
    const providerRes = await casinoService.getGameUrlV1({
      userId: req.userId,
      gameUid: req.body.game_uid || req.body.gameUid,
      language: req.body.language,
      platform: req.body.platform == null ? undefined : Number(req.body.platform),
      homeUrl: req.body.home_url || req.body.homeUrl,
      callbackUrlOverride: req.body.callback_url || req.body.callbackUrl,
    });

    res.json({
      success: true,
      data: providerRes,
    });
  } catch (err) {
    res.status(err.status || 400).json({
      success: false,
      message: err.message || 'Failed to get casino game URL',
    });
  }
};

const getGameV2 = async (req, res) => {
  try {
    const providerRes = await casinoService.getGameUrlV2({
      userId: req.userId,
      gameUid: req.body.game_uid || req.body.gameUid,
      transferId: req.body.transfer_id || req.body.transferId,
      transferAmount: req.body.credit_amount != null ? req.body.credit_amount : req.body.transfer_amount,
      language: req.body.language,
      platform: req.body.platform == null ? undefined : Number(req.body.platform),
      homeUrl: req.body.home_url || req.body.homeUrl,
    });

    res.json({
      success: true,
      data: providerRes,
    });
  } catch (err) {
    res.status(err.status || 400).json({
      success: false,
      message: err.message || 'Failed to get casino transfer game URL',
    });
  }
};

const getTransactionList = async (req, res) => {
  try {
    const providerRes = await casinoService.getGameTransactionList({
      userId: req.userId,
      fromDate: getRequiredNumber(req.body.from_date || req.body.fromDate, 'from_date'),
      toDate: getRequiredNumber(req.body.to_date || req.body.toDate, 'to_date'),
      pageNo: req.body.page_no || req.body.pageNo,
      pageSize: req.body.page_size || req.body.pageSize,
    });

    res.json({
      success: true,
      data: providerRes,
    });
  } catch (err) {
    res.status(err.status || 400).json({
      success: false,
      message: err.message || 'Failed to fetch casino transaction list',
    });
  }
};

const getProviders = async (req, res) => {
  try {
    const providerRes = await casinoService.getProviders({
      currency: req.query.currency,
      lang: req.query.lang,
      code: req.query.code,
    });
    res.json({ success: true, data: providerRes });
  } catch (err) {
    res.status(err.status || 400).json({
      success: false,
      message: err.message || 'Failed to fetch casino providers',
    });
  }
};

const getGameList = async (req, res) => {
  try {
    const providerRes = await casinoService.getGameList({
      supplierCode: req.query.code,
      currency: req.query.currency,
      lang: req.query.lang,
    });
    res.json({ success: true, data: providerRes });
  } catch (err) {
    res.status(err.status || 400).json({
      success: false,
      message: err.message || 'Failed to fetch casino game list',
    });
  }
};

const betCallback = async (req, res) => {
  // This endpoint is called by the casino provider.
  // Keep response shape aligned with provider docs: { code, msg, payload: (AES base64) }
  try {
    const agencyUid = req.body.agency_uid || req.body.agencyUid;
    const timestamp = req.body.timestamp;
    const payloadBase64 = req.body.payload;

    const result = await casinoService.handleBetCallback(
      { agencyUid, timestamp, payloadBase64 },
      req
    );

    return res.status(200).json({
      code: result.code,
      msg: result.msg,
      payload: result.payload,
    });
  } catch (err) {
    return res.status(200).json({ code: 1, msg: 'callback failed', payload: null });
  }
};

module.exports = {
  getGameV1,
  getGameV2,
  getTransactionList,
  getProviders,
  getGameList,
  betCallback,
};


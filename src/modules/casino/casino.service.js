const axios = require('axios');

const { User } = require('../../models/User');
const Wallet = require('../../models/Wallet');
const WalletTransaction = require('../../models/WalletTransaction');
const CasinoExternalEvent = require('../../models/CasinoExternalEvent');

const { withTransaction } = require('../../utils/transaction.helper');
const {
  encryptJsonPayload,
  decryptJsonPayload,
} = require('../../utils/huiduAes256');

const toInt = (amount) => Math.round(Number(amount) * 100);
const fromInt = (val) => Math.round(val) / 100;
const FLOAT_EPSILON = 0.0001;

const getConfig = () => {
  const serverUrl = process.env.HUIDU_SERVER_URL;
  const agencyUid = process.env.HUIDU_AGENCY_UID;
  const aesKey = process.env.HUIDU_AES_KEY;
  const defaultLanguage = process.env.HUIDU_DEFAULT_LANGUAGE || 'en';
  const defaultPlatform = Number(process.env.HUIDU_DEFAULT_PLATFORM || '1');
  const callbackUrl = process.env.HUIDU_CALLBACK_URL;

  if (!serverUrl || !agencyUid || !aesKey) {
    throw new Error('Casino provider is not configured. Set HUIDU_SERVER_URL, HUIDU_AGENCY_UID, HUIDU_AES_KEY in env.');
  }

  return {
    serverUrl: serverUrl.replace(/\/+$/, ''),
    agencyUid,
    aesKey,
    defaultLanguage,
    defaultPlatform,
    callbackUrl,
  };
};

const normalizeMemberAccount = (memberAccount) => {
  const prefix = process.env.HUIDU_MEMBER_ACCOUNT_PREFIX || '';
  let v = String(memberAccount || '');
  if (prefix && v.startsWith(prefix)) {
    v = v.slice(prefix.length);
  }
  return v;
};

const ensureUserAndWallet = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  if (!user.isActive) throw new Error('User is inactive');

  const wallet = await Wallet.findOne({ user: userId });
  if (!wallet) throw new Error('Wallet not found');
  if (!wallet.isActive) throw new Error('Wallet is inactive');
  if (wallet.isLocked) throw new Error(`Wallet is locked. ${wallet.lockedReason || ''}`);

  return { user, wallet };
};

const buildOuterRequest = async ({
  payloadObj,
  timestamp,
  agencyUid,
  aesKey,
}) => {
  const payloadBase64 = encryptJsonPayload(payloadObj, aesKey);
  return {
    agency_uid: agencyUid,
    timestamp: String(timestamp),
    payload: payloadBase64,
  };
};

const callProvider = async ({ method, url, data }) => {
  const { serverUrl } = getConfig();
  const apiTimeout = Number(process.env.API_TIMEOUT || 15000);

  const fullUrl = `${serverUrl}${url.startsWith('/') ? url : `/${url}`}`;
  const res = await axios.request({
    method,
    url: fullUrl,
    headers: { 'Content-Type': 'application/json' },
    data,
    timeout: apiTimeout,
  });
  return res.data;
};

/**
 * Get Game URL (SEAMLESS) wrapper
 * - Uses user's current wallet balance as credit_amount.
 * - Returns provider response {code,msg,payload:{game_launch_url:...}}.
 */
const getGameUrlV1 = async ({ userId, gameUid, language, platform, homeUrl, callbackUrlOverride }) => {
  const { agencyUid, aesKey, defaultLanguage, defaultPlatform, callbackUrl } = getConfig();
  const { wallet } = await ensureUserAndWallet(userId);

  const timestamp = Date.now();
  const creditAmount = wallet.balance;

  const payloadObj = {
    agency_uid: agencyUid,
    timestamp: String(timestamp),
    member_account: wallet.user ? wallet.user.username : undefined, // will be overwritten below if missing
    game_uid: String(gameUid),
    credit_amount: creditAmount.toFixed(2),
    currency_code: wallet.currency,
    language: language || defaultLanguage,
    home_url: homeUrl || undefined,
    platform: platform ?? defaultPlatform,
    callback_url: callbackUrlOverride || callbackUrl || undefined,
  };

  // wallet.user is not populated; set from DB user lookup
  const user = await User.findById(userId);
  payloadObj.member_account = user.username;

  // Remove undefined fields to avoid provider rejecting them.
  Object.keys(payloadObj).forEach((k) => payloadObj[k] === undefined && delete payloadObj[k]);

  const outer = await buildOuterRequest({
    payloadObj,
    timestamp,
    agencyUid,
    aesKey,
  });

  return callProvider({ method: 'post', url: '/game/v1', data: outer });
};

/**
 * Get Game URL (TRANSFER) wrapper
 * - Calls provider /game/v2 with transfer delta (credit_amount) + transfer_id.
 * - On success, attempts to sync local wallet balance with provider payload.after_amount (if present).
 */
const getGameUrlV2 = async ({
  userId,
  gameUid,
  transferId,
  transferAmount,
  language,
  platform,
  homeUrl,
}) => {
  const {
    agencyUid, aesKey, defaultLanguage, defaultPlatform,
  } = getConfig();

  if (!transferId) throw new Error('transfer_id is required');

  const { wallet } = await ensureUserAndWallet(userId);
  const transferAmountNum = transferAmount == null ? 0 : Number(transferAmount);
  if (Number.isNaN(transferAmountNum)) throw new Error('transfer_amount must be a number');

  // If provider callback is retried, we still want idempotency for wallet syncing.
  const existingTransfer = await CasinoExternalEvent.findOne({
    type: 'transfer',
    id: String(transferId),
  });
  if (existingTransfer) {
    return {
      code: existingTransfer.code ?? 0,
      msg: existingTransfer.msg || 'Transfer already processed',
      payload: existingTransfer.data || {},
    };
  }

  const timestamp = Date.now();
  const payloadObj = {
    agency_uid: agencyUid,
    timestamp: String(timestamp),
    member_account: (await User.findById(userId)).username,
    game_uid: gameUid == null ? undefined : String(gameUid),
    credit_amount: String(transferAmountNum),
    currency_code: wallet.currency,
    language: language || defaultLanguage,
    home_url: homeUrl || undefined,
    platform: platform ?? defaultPlatform,
    transfer_id: String(transferId),
  };

  Object.keys(payloadObj).forEach((k) => payloadObj[k] === undefined && delete payloadObj[k]);

  const outer = await buildOuterRequest({
    payloadObj,
    timestamp,
    agencyUid,
    aesKey,
  });

  const providerRes = await callProvider({ method: 'post', url: '/game/v2', data: outer });

  // Sync local wallet based on provider payload if possible.
  const providerCode = Number(providerRes?.code);
  const providerPayload = providerRes?.payload || {};
  const afterAmountRaw = providerPayload?.after_amount;
  const beforeAmountRaw = providerPayload?.before_amount;

  let creditAfter = null;
  if (afterAmountRaw != null && afterAmountRaw !== '') {
    const parsed = Number(afterAmountRaw);
    if (!Number.isNaN(parsed)) creditAfter = parsed;
  }

  if (providerCode === 0 && creditAfter != null) {
    await withTransaction(async (session) => {
      const walletQuery = Wallet.findOne({ user: userId });
      const walletRow = session ? await walletQuery.session(session) : await walletQuery;
      if (!walletRow) throw new Error('Wallet not found');

      const creditBefore = walletRow.balance;
      const delta = creditAfter - creditBefore;

      if (Math.abs(delta) > FLOAT_EPSILON) {
        const txType = delta >= 0 ? WalletTransaction.TRANSACTION_TYPES.CREDIT : WalletTransaction.TRANSACTION_TYPES.DEBIT;
        const absAmount = Math.abs(delta);

        walletRow.balance = creditAfter;
        walletRow.lastTransactionAt = new Date();
        await walletRow.save(session ? { session } : undefined);

        await WalletTransaction.create(
          [
            {
              wallet: walletRow._id,
              user: userId,
              transactionType: txType,
              amount: absAmount,
              balanceBefore: creditBefore,
              balanceAfter: walletRow.balance,
              currency: walletRow.currency,
              status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
              description: `Casino transfer sync (${transferId})`,
              performedBy: userId,
              metadata: {
                type: 'casino_transfer_sync',
                transferId: String(transferId),
                providerBefore: beforeAmountRaw,
                providerAfter: afterAmountRaw,
                synced: true,
              },
            },
          ],
          session ? { session } : undefined
        );
      }

      await CasinoExternalEvent.create(
        [
          {
            type: 'transfer',
            id: String(transferId),
            user: userId,
            memberAccount: (await User.findById(userId)).username,
            currencyCode: walletRow.currency,
            requestTimestamp: String(timestamp),
            transferId: String(transferId),
            code: providerCode,
            msg: providerRes?.msg || null,
            creditBefore: beforeAmountRaw != null ? Number(beforeAmountRaw) : creditBefore,
            creditAfter: Number(afterAmountRaw),
            data: providerPayload,
          },
        ],
        session ? { session } : undefined
      );
    });
  } else {
    // Store idempotency record even on failure so we don't retry wallet syncing blindly.
    await CasinoExternalEvent.create({
      type: 'transfer',
      id: String(transferId),
      user: userId,
      memberAccount: (await User.findById(userId)).username,
      currencyCode: wallet.currency,
      requestTimestamp: String(timestamp),
      transferId: String(transferId),
      code: providerCode,
      msg: providerRes?.msg || null,
      creditBefore: beforeAmountRaw != null ? Number(beforeAmountRaw) : null,
      creditAfter: creditAfter,
      data: providerPayload,
    });
  }

  return providerRes;
};

const getGameTransactionList = async ({ userId, fromDate, toDate, pageNo, pageSize }) => {
  const { agencyUid, aesKey } = getConfig();
  const { wallet } = await ensureUserAndWallet(userId);

  const timestamp = Date.now();
  const payloadObj = {
    timestamp: String(timestamp),
    agency_uid: agencyUid,
    from_date: String(fromDate),
    to_date: String(toDate),
    page_no: Number(pageNo || 1),
    page_size: Number(pageSize || 30),
  };

  const outer = await buildOuterRequest({ payloadObj, timestamp, agencyUid, aesKey });

  // Provider endpoint expects member_account? (not in guide) so we just pass required fields.
  const providerRes = await callProvider({
    method: 'post',
    url: '/game/transaction/list',
    data: outer,
  });

  return providerRes;
};

const getProviders = async ({ currency, lang, code }) => {
  const { agencyUid } = getConfig();
  const apiTimeout = Number(process.env.API_TIMEOUT || 15000);
  const { serverUrl } = getConfig();

  const res = await axios.get(`${serverUrl}/game/providers`, {
    params: {
      agency_uid: agencyUid,
      currency: currency || undefined,
      lang: lang || undefined,
      code: code || undefined,
    },
    timeout: apiTimeout,
  });
  return res.data;
};

const getGameList = async ({ supplierCode, currency, lang }) => {
  const { agencyUid } = getConfig();
  const apiTimeout = Number(process.env.API_TIMEOUT || 15000);
  const { serverUrl } = getConfig();

  const res = await axios.get(`${serverUrl}/game/list`, {
    params: {
      agency_uid: agencyUid,
      currency: currency || undefined,
      lang: lang || undefined,
      code: supplierCode || undefined,
    },
    timeout: apiTimeout,
  });
  return res.data;
};

/**
 * Bet callback handler:
 * - Decrypt incoming payload.
 * - Apply wallet delta: credit_amount = credit_amount - bet_amount + win_amount.
 * - Respond with encrypted payload containing updated credit_amount.
 * - Idempotent via serial_number.
 */
const handleBetCallback = async ({ agencyUid, timestamp, payloadBase64 }, req) => {
  const { aesKey, agencyUid: expectedAgencyUid } = getConfig();

  // Decrypt first; provider may retry even if agency uid mismatches.
  let decrypted;
  try {
    decrypted = decryptJsonPayload(payloadBase64, aesKey);
  } catch (e) {
    // If we can't decrypt, return failure with zero balance.
    const encrypted = encryptJsonPayload({ credit_amount: '0.00', timestamp: String(timestamp) }, aesKey);
    return { code: 1, msg: 'payload decrypt failed', payload: encrypted, creditAfter: 0 };
  }

  if (agencyUid && String(agencyUid) !== String(expectedAgencyUid)) {
    const encrypted = encryptJsonPayload({ credit_amount: '0.00', timestamp: String(timestamp) }, aesKey);
    return { code: 1, msg: 'agency_uid mismatch', payload: encrypted, creditAfter: 0 };
  }

  const serialNumber = String(decrypted.serial_number || '');
  if (!serialNumber) {
    const encrypted = encryptJsonPayload({ credit_amount: '0.00', timestamp: String(timestamp) }, aesKey);
    return { code: 1, msg: 'serial_number missing', payload: encrypted, creditAfter: 0 };
  }

  // Idempotency check
  const existing = await CasinoExternalEvent.findOne({ type: 'bet_callback', id: serialNumber });
  if (existing) {
    const creditAfter = existing.creditAfter ?? 0;
    const encrypted = encryptJsonPayload(
      { credit_amount: Number(creditAfter).toFixed(2), timestamp: String(timestamp) },
      aesKey
    );
    return { code: existing.code ?? 0, msg: existing.msg || 'already processed', payload: encrypted, creditAfter };
  }

  const memberAccount = normalizeMemberAccount(decrypted.member_account);
  const user = await User.findOne({ username: memberAccount });
  if (!user) {
    const encrypted = encryptJsonPayload({ credit_amount: '0.00', timestamp: String(timestamp) }, aesKey);
    return { code: 1, msg: 'player not found', payload: encrypted, creditAfter: 0 };
  }

  const wallet = await Wallet.findOne({ user: user._id });
  if (!wallet || !wallet.isActive) {
    const encrypted = encryptJsonPayload({ credit_amount: '0.00', timestamp: String(timestamp) }, aesKey);
    return { code: 1, msg: 'wallet not found', payload: encrypted, creditAfter: 0 };
  }

  const currencyCode = decrypted.currency_code;
  if (currencyCode && String(currencyCode).toUpperCase() !== String(wallet.currency).toUpperCase()) {
    const encrypted = encryptJsonPayload(
      { credit_amount: Number(wallet.balance).toFixed(2), timestamp: String(timestamp) },
      aesKey
    );
    return { code: 1, msg: 'currency mismatch', payload: encrypted, creditAfter: wallet.balance };
  }

  const betAmount = decrypted.bet_amount;
  const winAmount = decrypted.win_amount;
  const betInt = toInt(betAmount);
  const winInt = toInt(winAmount);

  // net = -bet_amount + win_amount
  const netInt = -betInt + winInt;

  const walletBeforeInt = toInt(wallet.balance);
  let walletAfterInt = walletBeforeInt + netInt;

  let code = 0;
  let msg = 'success';

  // Wallet can't go below 0; cap and mark failure if it would have.
  if (walletAfterInt < 0) {
    code = 1;
    msg = 'insufficient balance';
    walletAfterInt = 0;
  }

  const actualNetInt = walletAfterInt - walletBeforeInt;
  const creditAfter = fromInt(walletAfterInt);

  await withTransaction(async (session) => {
    const walletQuery = Wallet.findOne({ user: user._id });
    const walletRow = session ? await walletQuery.session(session) : await walletQuery;
    if (!walletRow) throw new Error('Wallet not found during settlement');

    const before = walletRow.balance;
    walletRow.balance = creditAfter;
    walletRow.lastTransactionAt = new Date();
    await walletRow.save(session ? { session } : undefined);

    if (actualNetInt !== 0) {
      const txType = actualNetInt >= 0 ? WalletTransaction.TRANSACTION_TYPES.CREDIT : WalletTransaction.TRANSACTION_TYPES.DEBIT;
      const absAmount = Math.abs(fromInt(actualNetInt));

      await WalletTransaction.create(
        [
          {
            wallet: walletRow._id,
            user: user._id,
            transactionType: txType,
            amount: absAmount,
            balanceBefore: before,
            balanceAfter: walletRow.balance,
            currency: walletRow.currency,
            status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
            description: `Casino bet settlement (${serialNumber})`,
            performedBy: user._id,
            metadata: {
              type: 'casino_bet_settlement',
              serialNumber,
              gameUid: decrypted.game_uid || null,
              gameRound: decrypted.game_round || null,
              betAmount: Number(betAmount),
              winAmount: Number(winAmount),
              netAmount: fromInt(netInt),
              capped: code === 1,
              rawData: decrypted.data || {},
            },
            ipAddress: req ? req.ip : null,
            userAgent: req ? req.get('user-agent') : null,
          },
        ],
        session ? { session } : undefined
      );
    }

    await CasinoExternalEvent.create(
      [
        {
          type: 'bet_callback',
          id: serialNumber,
          user: user._id,
          memberAccount: memberAccount,
          currencyCode: walletRow.currency,
          requestTimestamp: String(timestamp),
          gameUid: decrypted.game_uid || null,
          gameRound: decrypted.game_round || null,
          data: decrypted.data || {},
          serialNumber,
          betAmount: betInt == null ? null : fromInt(betInt),
          winAmount: winInt == null ? null : fromInt(winInt),
          netAmount: fromInt(netInt),
          code,
          msg,
          creditBefore: fromInt(walletBeforeInt),
          creditAfter,
          rawRequest: decrypted,
        },
      ],
      session ? { session } : undefined
    );
  });

  const encryptedPayload = encryptJsonPayload(
    { credit_amount: creditAfter.toFixed(2), timestamp: String(timestamp) },
    aesKey
  );

  return { code, msg, payload: encryptedPayload, creditAfter };
};

module.exports = {
  getGameUrlV1,
  getGameUrlV2,
  getGameTransactionList,
  getProviders,
  getGameList,
  handleBetCallback,
};


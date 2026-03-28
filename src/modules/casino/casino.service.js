const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mongoose = require('mongoose');
const walletService = require('../wallet/wallet.service');
const Wallet = require('../../models/Wallet');
const Bet = require('../../models/Bet');
const { withTransaction } = require('../../utils/transaction.helper');

const AES_KEY = process.env.CASINO_AES_KEY || '168f3ea1b9f3f24aca63c6d9b5ce0238';
const PLAYER_PREFIX = process.env.CASINO_PLAYER_PREFIX || 'h6b144';
const AGENCY_ID = process.env.CASINO_AGENCY_ID || '20b644819cfcaf95015e2f0e558eaa30';
const API_URL = process.env.CASINO_API_URL || 'https://huidu.bet';
const HOME_URL = process.env.CASINO_HOME_URL || 'https://kingexch365.vip';
const CALLBACK_URL = process.env.CASINO_CALLBACK_URL || 'https://api.kingexch365.vip/api/casino/callback/bet';
const LEGACY_MEMBER_USER_ID_LENGTH = Number(process.env.CASINO_MEMBER_USER_ID_LENGTH || 20);
const sessionOpts = (session) => (session ? { session } : {});

const GAMELIST_DIR = path.join(__dirname, 'gamelist');
let gameHashCache = null;

const buildGameHashCache = () => {
  if (gameHashCache) return gameHashCache;
  gameHashCache = new Map();

  const files = fs.readdirSync(GAMELIST_DIR).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(GAMELIST_DIR, file), 'utf8').replace(/^\uFEFF/, '');
      const games = JSON.parse(raw);
      if (!Array.isArray(games)) continue;
      for (const g of games) {
        if (g.gameHash) gameHashCache.set(g.gameHash, g.gameName || '');
      }
    } catch (_) { /* skip invalid files */ }
  }
  return gameHashCache;
};

const findGameNameByHash = (gameHash) => buildGameHashCache().get(gameHash) || null;

const slugToTitle = (slug) =>
  String(slug || '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

// Stores gameHash → gameName at launch time so callbacks can resolve names
// even when the hash isn't in the static JSON files.
const launchedGamesCache = new Map();

const encryptPayloadToBase64 = (params, keyString = AES_KEY) => {
  if (!keyString || keyString.length !== 32) {
    throw new Error('CASINO_AES_KEY must be exactly 32 characters for AES-256-ECB.');
  }

  const cipher = crypto.createCipheriv('aes-256-ecb', Buffer.from(keyString, 'utf8'), null);
  cipher.setAutoPadding(true);

  const encryptedBuffer = Buffer.concat([
    cipher.update(JSON.stringify(params), 'utf8'),
    cipher.final(),
  ]);

  return encryptedBuffer.toString('base64');
};

const createLaunchUrl = async ({
  userId,
  vendorId,
  gameHash,
  gameName: suppliedGameName,
  currencyCode,
  language,
  creditAmount,
  platform,
}) => {
  const resolvedName = suppliedGameName
    || findGameNameByHash(gameHash)
    || gameHash;
  launchedGamesCache.set(gameHash, resolvedName);

  const timestamp = Date.now();
  const memberAccount = `${PLAYER_PREFIX}${vendorId}${userId}`;

  const payloadParams = {
    timestamp,
    agency_uid: AGENCY_ID,
    member_account: memberAccount,
    game_uid: gameHash,
    credit_amount: creditAmount,
    currency_code: currencyCode,
    language,
    home_url: HOME_URL,
    platform,
    callback_url: CALLBACK_URL,
  };

  const payload = encryptPayloadToBase64(payloadParams, AES_KEY);
  const requestData = {
    agency_uid: AGENCY_ID,
    timestamp,
    payload,
  };

  const response = await axios.post(`${API_URL}/game/v1`, requestData, {
    headers: { 'Content-Type': 'application/json' },
  });

  const apiResponse = response.data;

  if (apiResponse?.msg !== 'Success' || !apiResponse?.payload?.game_launch_url) {
    throw new Error(`Unable to launch game. Provider message: ${apiResponse?.msg || 'Unknown error'}`);
  }

  return apiResponse.payload.game_launch_url;
};

const decryptPayloadFromBase64 = (payload, keyString = AES_KEY) => {
  if (!payload) {
    throw new Error('Missing payload');
  }

  const decipher = crypto.createDecipheriv('aes-256-ecb', Buffer.from(keyString, 'utf8'), null);
  decipher.setAutoPadding(true);

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload, 'base64')),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8'));
};

const extractUserIdFromMemberAccount = (memberAccount = '') => {
  // Current format: <prefix><vendorId><mongoUserId>; use mongo id suffix first.
  const mongoCandidate = String(memberAccount).slice(-24);
  if (mongoose.Types.ObjectId.isValid(mongoCandidate)) {
    return mongoCandidate;
  }

  // Fallback for legacy numeric/short user ids.
  return String(memberAccount).slice(-LEGACY_MEMBER_USER_ID_LENGTH);
};

const callbackBet = async (body = {}) => {
  console.log('[casino.callbackBet] Callback received');

  if (!body.payload) {
    console.log('[casino.callbackBet] Missing payload in request body');
    return { code: 1, message: 'Missing payload', payload: null };
  }

  let decryptedPayload;
  try {
    decryptedPayload = decryptPayloadFromBase64(body.payload, AES_KEY);
    console.log('[casino.callbackBet] Payload decrypted successfully', decryptedPayload);
  } catch (error) {
    console.error('[casino.callbackBet] Payload decryption failed:', error.message);
    return { code: 1, message: 'Invalid decrypted data', payload: null };
  }

  const userId = extractUserIdFromMemberAccount(decryptedPayload.member_account);
  console.log('[casino.callbackBet] User resolved from member_account:', userId);

  const betAmount = Number(decryptedPayload.bet_amount || 0);
  const winAmount = Number(decryptedPayload.win_amount || 0);

  const rawGameName = findGameNameByHash(decryptedPayload.game_uid)
    || launchedGamesCache.get(decryptedPayload.game_uid)
    || decryptedPayload.game_uid
    || 'unknown_game';
  const gameName = slugToTitle(rawGameName);

  let settlementResult;
  if (betAmount < 0) {
    settlementResult = Bet.BET_RESULT.VOID;
  } else if (winAmount > 0) {
    settlementResult = Bet.BET_RESULT.WON;
  } else if (betAmount > 0) {
    settlementResult = Bet.BET_RESULT.LOST;
  } else {
    settlementResult = Bet.BET_RESULT.VOID;
  }

  const wallet = await walletService.getBalance(userId);
  const userCredit = Number(wallet.balance || 0);
  const currentBalance = userCredit - betAmount + winAmount;

  console.log('[casino.callbackBet] Settlement values:', {
    game_uid: decryptedPayload.game_uid,
    gameName,
    betAmount,
    winAmount,
    prevBalance: userCredit,
    currentBalance,
    settlementResult,
  });

  const responsePayload = {
    credit_amount: Math.round(currentBalance * 100) / 100,
    timestamp: Date.now(),
  };

  await withTransaction(async (session) => {
    const walletDoc = await Wallet.findOne({ user: userId }, null, sessionOpts(session));
    if (!walletDoc) {
      throw new Error('Wallet not found');
    }

    walletDoc.balance = Math.round(currentBalance * 100) / 100;
    walletDoc.lastTransactionAt = new Date();
    await walletDoc.save(sessionOpts(session));

    await Bet.create([{
      userId,
      sport: 'casino',
      eventId: decryptedPayload.game_uid,
      eventName: gameName,
      eventJsonStamp: decryptedPayload,
      marketId: decryptedPayload.game_round,
      marketName: gameName,
      marketType: Bet.MARKET_TYPES.CASINO,
      selectionId: decryptedPayload.serial_number,
      selectionName: gameName,
      betType: 'back',
      stake: Math.abs(betAmount),
      exposure: Math.abs(betAmount),
      winAmount,
      status: Bet.BET_STATUS.SETTLED,
      settlementResult,
      settledAt: new Date(),
    }], sessionOpts(session));

    console.log('[casino.callbackBet] Bet recorded & wallet updated:', {
      userId,
      gameName,
      betAmount,
      winAmount,
      settlementResult,
      newBalance: walletDoc.balance,
    });
  });

  const encryptedPayload = encryptPayloadToBase64(responsePayload, AES_KEY);
  console.log('[casino.callbackBet] Response payload encrypted and returning success');
  return { code: 0, message: 'Success', payload: encryptedPayload };
};

module.exports = {
  createLaunchUrl,
  callbackBet,
};

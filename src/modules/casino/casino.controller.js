const fs = require('fs');
const path = require('path');

const casinoService = require('./casino.service');
const walletService = require('../wallet/wallet.service');

const GAMELIST_DIR = path.join(__dirname, 'gamelist');

// Cache JSON payloads (read from disk once per type).
const gamesByTypeCache = new Map(); // type -> Array<game>
let gameTypesCache = null; // string[]

const normalizeType = (type) => String(type || '').trim().toLowerCase();

const encodeAssetPath = (relativePath) => {
  // Encode each path segment but keep `/` separators.
  // Handles spaces, parentheses, etc.
  return String(relativePath || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
};

const attachImageLocations = (req, games) => {
  // In this project the API base is `/api`, then `/casino`, and we serve images at:
  // `/api/casino/gamelist/assets/...` (even though the list logic now lives in `casino.*`).
  const assetsBaseUrl = `${req.baseUrl}/gamelist/assets`;

  return (games || []).map((game) => {
    const gameImage = game?.gameImage;
    const gameImageUrl = typeof gameImage === 'string' && gameImage.length
      ? `${assetsBaseUrl}/${encodeAssetPath(gameImage)}`
      : null;

    return {
      ...game,
      gameImageUrl,
      image: gameImageUrl, // convenience alias for frontend
    };
  });
};

const loadGamesJsonForType = (type) => {
  const normalizedType = normalizeType(type);
  if (gamesByTypeCache.has(normalizedType)) return gamesByTypeCache.get(normalizedType);

  const jsonPath = path.join(GAMELIST_DIR, `${normalizedType}.json`);
  if (!fs.existsSync(jsonPath)) return null;

  // Some JSON files include a UTF-8 BOM, which breaks JSON.parse().
  const raw = fs.readFileSync(jsonPath, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);
  gamesByTypeCache.set(normalizedType, parsed);
  return parsed;
};

const getGameTypes = () => {
  if (gameTypesCache) return gameTypesCache;

  const files = fs.readdirSync(GAMELIST_DIR);
  gameTypesCache = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.basename(f, '.json'))
    .sort();

  return gameTypesCache;
};

const listGameTypes = async (req, res) => {
  try {
    const types = getGameTypes();
    return res.json({
      success: true,
      data: types,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to list casino game types',
      error: error.message,
    });
  }
};

const listGamesByTypeInternal = async (req, res, type) => {
  try {
    const normalizedType = normalizeType(type);
    const games = loadGamesJsonForType(normalizedType);

    if (!games) {
      return res.status(404).json({
        success: false,
        message: `Game type not found: ${normalizedType}`,
      });
    }

    return res.json({
      success: true,
      data: attachImageLocations(req, games),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to load casino games',
      error: error.message,
    });
  }
};

const anderbaharGameList = async (req, res) => {
  return listGamesByTypeInternal(req, res, 'anderbahar');
};

const listGamesByType = async (req, res) => {
  return listGamesByTypeInternal(req, res, req.params.type);
};

const getGameByHash = async (req, res) => {
  try {
    const targetGameHash = String(req.params.gamehash || '').trim();
    if (!targetGameHash) {
      return res.status(400).json({
        success: false,
        message: 'Missing gamehash',
      });
    }

    const types = getGameTypes();
    const matches = [];

    // Search across all type JSON lists for the provided gameHash.
    for (const type of types) {
      const games = loadGamesJsonForType(type);
      if (!Array.isArray(games)) continue;

      for (const game of games) {
        if (game?.gameHash === targetGameHash) {
          matches.push(game);
        }
      }
    }

    if (matches.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Game not found for gamehash: ${targetGameHash}`,
      });
    }

    return res.json({
      success: true,
      data: attachImageLocations(req, matches),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to load casino game by hash',
      error: error.message,
    });
  }
};

const launchGame = async (req, res) => {
  try {
    const wallet = await walletService.getBalance(req.userId);
    const memberUserIdentity = req.userId.toString();

    const launchUrl = await casinoService.createLaunchUrl({
      userId: memberUserIdentity,
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
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to launch casino game',
      error: error.message,
    });
  }
};

const callbackBet = async (req, res) => {
  try {
    const result = await casinoService.callbackBet(req.body);
    console.log('[casino.callbackBet] Result:', result);
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
  listGameTypes,
  anderbaharGameList,
  listGamesByType,
  getGameByHash,
};
const allowedIps = (process.env.SETTLEMENT_ALLOWED_IPS || '')
  .split(',')
  .map(ip => ip.trim())
  .filter(Boolean);

/**
 * Internal auth for settlement endpoint (server-to-server).
 * Requires a shared API key and, optionally, an IP allowlist.
 *
 * Env vars:
 * - SETTLEMENT_API_KEY: required shared secret
 * - SETTLEMENT_ALLOWED_IPS: optional comma-separated list of allowed IPs
 */
const settlementInternalAuth = (req, res, next) => {
  const expectedApiKey = process.env.SETTLEMENT_API_KEY;

  if (!expectedApiKey) {
    return res.status(500).json({
      success: false,
      message: 'Settlement API key is not configured on the server.'
    });
  }

  const apiKey =
    req.headers['x-api-key'] ||
    req.headers['x-internal-key'] ||
    req.headers['x-settlement-key'];

  if (!apiKey || apiKey !== expectedApiKey) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or missing settlement API key.'
    });
  }

  if (allowedIps.length > 0) {
    const clientIp = req.ip;

    if (!allowedIps.includes(clientIp)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: IP address is not allowed for settlement.'
      });
    }
  }

  return next();
};

module.exports = {
  settlementInternalAuth
};


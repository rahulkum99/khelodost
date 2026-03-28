/**
 * Normalize IP for comparison (trim, strip quotes, IPv4-mapped IPv6).
 */
const normalizeIp = (ip) => {
  if (ip == null || ip === '') return '';
  let s = String(ip).trim().replace(/^["']|["']$/g, '');
  if (s.startsWith('::ffff:')) s = s.slice(7);
  return s;
};

/**
 * Parse SETTLEMENT_ALLOWED_IPS:
 * - JSON array: ["127.0.0.1","::1"]
 * - Comma-separated: 127.0.0.1, ::1, 10.0.0.5
 */
const parseAllowedIps = () => {
  const raw = (process.env.SETTLEMENT_ALLOWED_IPS || '').trim();
  if (!raw) return [];

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((ip) => normalizeIp(ip)).filter(Boolean);
      }
    } catch {
      /* fall through to comma split */
    }
  }

  return raw
    .split(',')
    .map((ip) => normalizeIp(ip))
    .filter(Boolean);
};

const getAllowedIps = () => parseAllowedIps();

/**
 * Internal auth for settlement endpoint (server-to-server).
 * By default: valid API key only — any client IP is allowed.
 *
 * Env vars:
 * - SETTLEMENT_API_KEY: required shared secret
 * - SETTLEMENT_ENFORCE_IP_ALLOWLIST: set to "true" to restrict by SETTLEMENT_ALLOWED_IPS
 * - SETTLEMENT_ALLOWED_IPS: JSON array or comma-separated IPs (required when enforcement is on)
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

  const enforceIp =
    String(process.env.SETTLEMENT_ENFORCE_IP_ALLOWLIST || '').toLowerCase() === 'true';

  if (enforceIp) {
    const allowedIps = getAllowedIps();
    if (allowedIps.length === 0) {
      return res.status(500).json({
        success: false,
        message:
          'SETTLEMENT_ENFORCE_IP_ALLOWLIST is enabled but SETTLEMENT_ALLOWED_IPS is empty.'
      });
    }
    const clientIp = normalizeIp(req.ip || req.socket?.remoteAddress);
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


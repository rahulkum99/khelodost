const crypto = require('crypto');

const normalizeAesKeyTo32Bytes = (key) => {
  if (typeof key !== 'string' || !key) {
    throw new Error('AES key is missing or invalid');
  }

  // If key is provided as 64-char hex (32 bytes), decode it.
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, 'hex');
  }

  // Otherwise treat it as a UTF-8 string; many HUIDU configs provide a 32-char ASCII key.
  const buf = Buffer.from(key, 'utf8');
  if (buf.length !== 32) {
    throw new Error(`AES key must be 32 bytes (got ${buf.length}). If this is hex, provide 64 hex chars.`);
  }
  return buf;
};

/**
 * HUIDU uses AES-256-ECB with PKCS7 padding.
 * Payloads are transmitted as Base64 strings.
 */
const encryptToBase64 = (plainText, aesKey) => {
  const key = normalizeAesKeyTo32Bytes(aesKey);

  const cipher = crypto.createCipheriv('aes-256-ecb', key, null);
  cipher.setAutoPadding(true); // PKCS7 padding

  let encrypted = cipher.update(plainText, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
};

const decryptFromBase64 = (cipherTextBase64, aesKey) => {
  const key = normalizeAesKeyTo32Bytes(aesKey);

  const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
  decipher.setAutoPadding(true); // PKCS7 padding

  let decrypted = decipher.update(cipherTextBase64, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

const encryptJsonPayload = (obj, aesKey) => {
  const jsonString = JSON.stringify(obj);
  return encryptToBase64(jsonString, aesKey);
};

const decryptJsonPayload = (payloadBase64, aesKey) => {
  const decrypted = decryptFromBase64(payloadBase64, aesKey);
  return JSON.parse(decrypted);
};

module.exports = {
  encryptToBase64,
  decryptFromBase64,
  encryptJsonPayload,
  decryptJsonPayload,
};


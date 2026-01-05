const axios = require('axios');

/**
 * Get location and ISP information from IP address
 * Using ip-api.com (free tier: 45 requests/minute)
 */
const getIpLocation = async (ipAddress) => {
  // Skip for localhost/private IPs
  if (ipAddress === '127.0.0.1' || ipAddress === '::1' || ipAddress.startsWith('192.168.') || ipAddress.startsWith('10.')) {
    return {
      isp: 'Local Network',
      city: 'Local',
      state: 'Local',
      country: 'Local'
    };
  }

  try {
    const response = await axios.get(`http://ip-api.com/json/${ipAddress}?fields=status,message,country,regionName,city,isp`, {
      timeout: 5000
    });

    if (response.data.status === 'success') {
      return {
        isp: response.data.isp || 'Unknown',
        city: response.data.city || 'Unknown',
        state: response.data.regionName || 'Unknown',
        country: response.data.country || 'Unknown'
      };
    }

    return {
      isp: 'Unknown',
      city: 'Unknown',
      state: 'Unknown',
      country: 'Unknown'
    };
  } catch (error) {
    console.error('Error fetching IP location:', error.message);
    return {
      isp: 'Unknown',
      city: 'Unknown',
      state: 'Unknown',
      country: 'Unknown'
    };
  }
};

/**
 * Extract IP address from request
 */
const getClientIp = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         req.ip ||
         '127.0.0.1';
};

/**
 * Parse user agent to get device, browser, OS info
 */
const parseUserAgent = (userAgent) => {
  if (!userAgent) {
    return {
      device: 'Unknown',
      browser: 'Unknown',
      os: 'Unknown'
    };
  }

  const ua = userAgent.toLowerCase();
  
  // Detect OS
  let os = 'Unknown';
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';

  // Detect Browser
  let browser = 'Unknown';
  if (ua.includes('chrome') && !ua.includes('edg')) browser = 'Chrome';
  else if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
  else if (ua.includes('edg')) browser = 'Edge';
  else if (ua.includes('opera') || ua.includes('opr')) browser = 'Opera';

  // Detect Device
  let device = 'Desktop';
  if (ua.includes('mobile')) device = 'Mobile';
  else if (ua.includes('tablet') || ua.includes('ipad')) device = 'Tablet';

  return {
    device,
    browser,
    os
  };
};

module.exports = {
  getIpLocation,
  getClientIp,
  parseUserAgent
};


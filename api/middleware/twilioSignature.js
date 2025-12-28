// Reusable Twilio signature validation middleware
const twilio = require('twilio');
const config = require('../config');

module.exports = function validateTwilioRequestFactory() {
  return function validateTwilioRequest(req, res, next) {
    if (!config.twilio.authToken) return next();

    const signature = req.headers['x-twilio-signature'];
    const url = config.server.hostname
      ? `https://${config.server.hostname}${req.originalUrl}`
      : `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const params = req.body || {};

    try {
      const valid = twilio.validateRequest(config.twilio.authToken, signature, url, params);
      if (!valid) return res.status(403).send('Invalid Twilio signature');
    } catch (err) {
      console.warn('Twilio signature validation error', err.message || err);
      return res.status(403).send('Invalid Twilio signature');
    }

    next();
  };
};

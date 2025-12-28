const config = require('../config');

const transferCall = async function (call) {

  console.log('Transferring call', call.callSid);
  const accountSid = config.twilio.accountSid;
  const authToken = config.twilio.authToken;
  const transferNumber = config.twilio.transferNumber;
  if (!transferNumber) {
    throw new Error('Transfer number not configured. Set TRANSFER_NUMBER in environment.');
  }
  const client = require('twilio')(accountSid, authToken);

  return await client.calls(call.callSid)
    .update({twiml: `<Response><Dial>${transferNumber}</Dial></Response>`})
    .then(() => {
      return 'The call was transferred successfully, say goodbye to the customer.';
    })
    .catch(() => {
      return 'The call was not transferred successfully, advise customer to call back later.';
    });
};

module.exports = transferCall;

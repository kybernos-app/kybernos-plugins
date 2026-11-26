// Who the visitor is, and at which level. The level comes from the CHANNEL, never from what the visitor writes.
//   1  anonymous (a browser, or a phone number the network only DISPLAYS: caller-ID can be forged)
//   2  the channel itself authenticates the sender (a WhatsApp number, a Telegram account: the Bot API only hands over the real account id)
//   3  a one-time code was verified on top
// The lookup key for anything personal is built here from the channel's own sender id: it is never taken from a message or a parameter.

export const LEVELS = Object.freeze({ site: 1, web: 1, tel: 1, tg: 2, wa: 2 });

export function identityLevel({ channel, codeVerified = false }) {
  if (codeVerified) return 3;
  return LEVELS[channel] || 1;
}

export const lookupKey = ({ channel, senderKey }) => `${channel}:${senderKey}`;

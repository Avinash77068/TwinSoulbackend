require('../config/firebase');
const { getMessaging } = require('firebase-admin/messaging');

const sendPushNotification = async ({ fcmToken, title, body, data = {} }) => {
  if (!fcmToken) return;

  const stringData = {};
  for (const [k, v] of Object.entries(data)) {
    stringData[k] = String(v);
  }

  const isCall = data.type === 'incoming_call';

  const message = isCall
    ? {
        token: fcmToken,
        data: stringData,
        android: { priority: 'high' },
        apns: {
          payload: {
            aps: { sound: 'ringtone.caf', 'content-available': 1 },
          },
        },
      }
    : {
        token: fcmToken,
        notification: { title, body },
        data: stringData,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'soulsync_default',
          },
        },
        apns: {
          payload: {
            aps: { sound: 'default', badge: 1, 'content-available': 1 },
          },
        },
      };

  try {
    await getMessaging().send(message);
  } catch (err) {
    if (
      err.code === 'messaging/invalid-registration-token' ||
      err.code === 'messaging/registration-token-not-registered'
    ) {
      const User = require('../models/User');
      await User.findOneAndUpdate({ fcmToken }, { fcmToken: '' });
      console.warn('[FCM] Cleared invalid token');
    } else {
      console.error('[FCM Error]', err.message);
    }
  }
};

module.exports = sendPushNotification;

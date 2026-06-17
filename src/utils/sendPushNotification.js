require('../config/firebase');
const { getMessaging } = require('firebase-admin/messaging');

const sendPushNotification = async ({ fcmToken, title, body, data = {} }) => {
  if (!fcmToken) return;

  const stringData = {};
  for (const [k, v] of Object.entries(data)) {
    stringData[k] = String(v);
  }

  try {
    await getMessaging().send({
      token: fcmToken,
      notification: { title, body },
      data: stringData,
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'default' },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    });
    
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

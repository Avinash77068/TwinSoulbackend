require('../config/firebase');
const { randomUUID } = require('crypto');
const { getMessaging } = require('firebase-admin/messaging');

// Must match NotificationChannels.DEFAULT_CHANNEL_ID in the app and the
// messaging_android_notification_channel_id in its firebase.json. Posting to a
// channel the app has not created gets silently downgraded to Firebase's
// "Miscellaneous" fallback channel, which is how pushes went missing.
const ANDROID_CHANNEL_ID = 'soulsync_default';

// A call push is worthless once the caller has stopped ringing (45s server-side),
// and a stale one delivered minutes later would ring for a call that no longer
// exists. Everything else is still worth showing for a day.
const CALL_TTL_MS = 45 * 1000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

// Same grouping rule the app uses (see displayGroupedNotification.groupKeyFor):
// a repeat of the same KIND replaces the row it already has instead of stacking
// a second one beside it, so one event can only ever occupy one notification.
const notificationTag = (data) => {
  const type = String(data.type || 'general');
  if (type === 'message') {
    return `message:${data.senderId || data.relationshipId || 'partner'}`;
  }
  return `type:${type}`;
};

const sendPushNotification = async ({ fcmToken, title, body, data = {} }) => {
  if (!fcmToken) return;

  const stringData = {};
  for (const [k, v] of Object.entries(data)) {
    stringData[k] = String(v);
  }

  // Lets the app drop a redelivery of the same event even when FCM assigns the
  // retry a different message id.
  if (!stringData.eventId) stringData.eventId = randomUUID();

  const isCall = data.type === 'incoming_call';

  const message = isCall
    ? {
        token: fcmToken,
        // Data-only on purpose: the app's native ringer owns the whole
        // incoming-call UI, so a system-drawn notification would double up.
        data: stringData,
        android: { priority: 'high', ttl: CALL_TTL_MS },
        apns: {
          payload: {
            aps: { sound: 'ringtone.caf', 'content-available': 1 },
          },
        },
      }
    : {
        token: fcmToken,
        // The notification block is what makes background AND killed-state
        // delivery independent of the app's JS ever starting: Firebase's own
        // service renders it. The app only renders its own copy in the
        // foreground, where the SDK deliberately does not.
        notification: { title, body },
        data: stringData,
        android: {
          priority: 'high',
          ttl: DEFAULT_TTL_MS,
          notification: {
            sound: 'default',
            channelId: ANDROID_CHANNEL_ID,
            tag: notificationTag(data),
            defaultVibrateTimings: true,
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

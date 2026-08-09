const ScheduledMessage = require('../models/ScheduledMessage');
const Message = require('../models/Message');

/**
 * Deliver due scheduled messages.
 * Moved out of server.js and wrapped in a distributed lock — previously two
 * instances would each deliver every message.
 */
module.exports = (scheduleLocked, io) => {
  scheduleLocked('scheduledMessages', '* * * * *', async () => {
    const pending = await ScheduledMessage.find({
      scheduledAt: { $lte: new Date() },
      isDelivered: false,
      isCancelled: false,
    }).limit(200);

    for (const sm of pending) {
      // Claim this row before sending, so a lock expiry mid-run cannot double-deliver.
      const claimed = await ScheduledMessage.findOneAndUpdate(
        { _id: sm._id, isDelivered: false, isCancelled: false },
        { isDelivered: true, deliveredAt: new Date() },
        { returnDocument: 'after' }
      );
      if (!claimed) continue;

      try {
        await Message.create({
          relationshipId: sm.relationshipId,
          senderId: sm.senderId,
          content: sm.content,
          type: sm.type,
          mediaUrl: sm.mediaUrl,
        });
        if (io) {
          io.to(`relationship:${sm.relationshipId}`).emit('message:new', {
            content: sm.content,
            type: 'scheduled',
          });
        }
      } catch (err) {
        // Release the claim so a later tick can retry.
        await ScheduledMessage.updateOne(
          { _id: sm._id },
          { isDelivered: false, deliveredAt: null }
        ).catch(() => {});
        throw err;
      }
    }

    if (pending.length) console.log(`[Cron] Delivered ${pending.length} scheduled message(s)`);
  });
};

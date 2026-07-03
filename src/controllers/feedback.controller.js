const Feedback = require('../models/Feedback');

const CATEGORIES = ['bug', 'suggestion', 'compliment', 'other'];

exports.submitFeedback = async (req, res) => {
  const { category, rating, message } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, message: 'Feedback message is required' });
  }

  const feedback = await Feedback.create({
    userId: req.user._id,
    relationshipId: req.user.relationshipId || null,
    category: CATEGORIES.includes(category) ? category : 'other',
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    message: message.trim(),
  });

  res.status(201).json({ success: true, message: 'Feedback submitted', data: { feedback } });
};

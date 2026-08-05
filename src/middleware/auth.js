const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    // Also accept token via query param (used by audio stream URLs)
    const queryToken = req.query.token;
    if (!authHeader && !queryToken) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const token = queryToken || authHeader?.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Still excludes `password`: the staleness check only needs passwordChangedAt,
    // and blanking a selected password field on the live document would make a
    // later req.user.save() try to re-hash `undefined`.
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    // A password change (or reset) invalidates every token issued before it, so a
    // stolen token stops working the moment the victim resets. Without this, a
    // reset would leave an attacker's existing session fully intact.
    if (typeof user.isTokenStale === 'function' && user.isTokenStale(decoded.iat)) {
      return res.status(401).json({
        success: false,
        message: 'Your password was changed. Please sign in again.',
        data: { reason: 'password_changed' },
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

module.exports = { protect };

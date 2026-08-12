const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ success: false, message: messages.join(', ') });
  }

  if (err.code === 11000) {
    // The colliding field name is an enumeration primitive — say what happened
    // without naming it.
    return res.status(409).json({ success: false, message: 'That value is already in use' });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, message: 'Invalid value provided' });
  }

  const status = err.status || 500;

  /**
   * Never return err.message for a 5xx.
   *
   * Almost no handler here has a local try/catch, so this is the default path
   * for every unexpected failure — and it was echoing raw internals straight to
   * the app: Atlas hostnames from MongooseServerSelectionError, driver messages,
   * JS TypeError text with internal identifiers, Cloudinary and Brevo detail.
   * 4xx messages are ours and deliberate, so those still pass through.
   */
  const safeMessage = status < 500
    ? (err.message || 'Request could not be completed')
    : 'Something went wrong. Please try again.';

  res.status(status).json({ success: false, message: safeMessage });
};

const notFound = (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
};

module.exports = { errorHandler, notFound };

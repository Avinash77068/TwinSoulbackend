const Theme = require('../models/Theme');
const { getIo } = require('../config/socketInstance');

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};

// Allowed CSS color formats for basic validation
const isValidColor = (val) => {
  if (typeof val !== 'string') return false;
  const v = val.trim();
  return (
    /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ||    // #RGB or #RRGGBB
    /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(\s*,\s*[\d.]+)?\s*\)$/.test(v) // rgb/rgba
  );
};

const ALLOWED_KEYS = [
  'mode',
  'background', 'surface', 'surfaceAlt',
  'bgGradient', 'bgGradientAngle',
  'primary', 'primaryMuted', 'accent',
  'text', 'textMuted', 'textFaint', 'textLabel',
  'border', 'borderStrong',
  'success', 'error', 'warning', 'online', 'offline',
  'badge', 'badgeBorder', 'badgeText',
];

const isValidGradient = (val) =>
  Array.isArray(val) && val.length >= 2 && val.every(isValidColor);

// GET /api/theme  — requires auth (theme is per-couple)
exports.getTheme = async (req, res) => {
  try {
    if (!requireRelationship(req, res)) return;

    // Get or auto-create this couple's theme doc
    let theme = await Theme.findOne({ relationshipId: req.user.relationshipId });
    if (!theme) {
      theme = await Theme.create({ relationshipId: req.user.relationshipId });
    }

    // Return only the color keys (not _id, __v, timestamps)
    const data = {};
    ALLOWED_KEYS.forEach(k => { if (theme[k] !== undefined) data[k] = theme[k]; });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/theme  — requires auth (only logged-in users can change theme)
exports.updateTheme = async (req, res) => {
  try {
    if (!requireRelationship(req, res)) return;

    const updates = {};
    const invalid = [];

    for (const [key, val] of Object.entries(req.body)) {
      if (!ALLOWED_KEYS.includes(key)) { invalid.push(key); continue; }

      if (key === 'mode') {
        if (val !== 'dark' && val !== 'light') { invalid.push(`${key}:${val}`); continue; }
        updates[key] = val;
      } else if (key === 'bgGradient') {
        if (!isValidGradient(val)) { invalid.push(`${key}:${JSON.stringify(val)}`); continue; }
        updates[key] = val;
      } else if (key === 'bgGradientAngle') {
        const n = Number(val);
        if (isNaN(n) || n < 0 || n > 360) { invalid.push(`${key}:${val}`); continue; }
        updates[key] = n;
      } else {
        if (!isValidColor(val)) { invalid.push(`${key}:${val}`); continue; }
        updates[key] = val.trim();
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid color keys provided',
        invalidKeys: invalid,
      });
    }

    const theme = await Theme.findOneAndUpdate(
      { relationshipId: req.user.relationshipId },
      { $set: updates },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const data = {};
    ALLOWED_KEYS.forEach(k => { if (theme[k] !== undefined) data[k] = theme[k]; });

    // Push to both partners' devices only — no restart needed
    const io = getIo();
    if (io) io.to(`relationship:${req.user.relationshipId}`).emit('theme:updated', data);

    res.json({
      success: true,
      message: 'Theme updated',
      data,
      ...(invalid.length > 0 && { skippedKeys: invalid }),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/theme/reset  — reset to defaults
exports.resetTheme = async (req, res) => {
  try {
    if (!requireRelationship(req, res)) return;

    await Theme.deleteOne({ relationshipId: req.user.relationshipId });
    const theme = await Theme.create({ relationshipId: req.user.relationshipId });

    const data = {};
    ALLOWED_KEYS.forEach(k => { if (theme[k] !== undefined) data[k] = theme[k]; });

    const io = getIo();
    if (io) io.to(`relationship:${req.user.relationshipId}`).emit('theme:updated', data);

    res.json({ success: true, message: 'Theme reset to defaults', data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const mongoose = require('mongoose');

const themeSchema = new mongoose.Schema(
  {
    // Only one theme document exists — singleton pattern
    name: { type: String, default: 'default', unique: true },

    // Core backgrounds
    background:  { type: String, default: '#0A0612' },
    surface:     { type: String, default: 'rgba(255,255,255,0.05)' },
    surfaceAlt:  { type: String, default: 'rgba(255,255,255,0.07)' },

    // Gradient background
    bgGradient:      { type: [String], default: ['#193543', '#0A0612', '#150A1E'] },
    bgGradientAngle: { type: Number,   default: 160 },

    // Brand colours
    primary:      { type: String, default: '#EC4899' },
    primaryMuted: { type: String, default: 'rgba(236,72,153,0.15)' },
    accent:       { type: String, default: '#F472B6' },

    // Text
    text:      { type: String, default: '#FFFFFF' },
    textMuted: { type: String, default: 'rgba(196,181,253,0.6)' },
    textFaint: { type: String, default: 'rgba(196,181,253,0.4)' },
    textLabel: { type: String, default: 'rgba(196,181,253,0.5)' },

    // Borders
    border:       { type: String, default: 'rgba(255,255,255,0.06)' },
    borderStrong: { type: String, default: 'rgba(255,255,255,0.12)' },

    // Status
    success: { type: String, default: '#4ade80' },
    error:   { type: String, default: '#f87171' },
    warning: { type: String, default: '#fcd34d' },
    online:  { type: String, default: '#4ade80' },
    offline: { type: String, default: '#6b7280' },

    // Badge / XP chip
    badge:       { type: String, default: 'rgba(236,72,153,0.2)' },
    badgeBorder: { type: String, default: 'rgba(236,72,153,0.4)' },
    badgeText:   { type: String, default: '#EC4899' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Theme', themeSchema);

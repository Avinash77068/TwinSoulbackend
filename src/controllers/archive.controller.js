const Relationship = require('../models/Relationship');
const User = require('../models/User');
const Message = require('../models/Message');
const Photo = require('../models/Photo');
const Album = require('../models/Album');
const Diary = require('../models/Diary');
const TimeCapsule = require('../models/TimeCapsule');
const TimelineEvent = require('../models/TimelineEvent');
const Goal = require('../models/Goal');
const LoveTree = require('../models/LoveTree');
const RelationshipLevel = require('../models/RelationshipLevel');
const relService = require('../services/relationship.service');
const statsService = require('../services/stats.service');
const { resolveStageInfo } = require('../constants/progression');
const { PURGE_DELAY_DAYS, ARCHIVE_RETENTION_MONTHS } = require('../constants/lifecycle');

/**
 * Archived-relationship read path.
 *
 * CRITICAL: every other controller resolves content via `req.user.relationshipId`,
 * which is null once a relationship ends — so archived memories were completely
 * unreachable even though nothing had been deleted. Authorisation here is by
 * MEMBERSHIP in Relationship.user1/user2, not by the caller's *current*
 * relationship.
 *
 * Two invariants this file must always hold:
 *   1. Only a member may read a chapter.
 *   2. Only non-live chapters are served here, so archived content can never be
 *      surfaced into a live/shared view (which would leak a previous
 *      relationship's content to a new partner).
 */

const ARCHIVED_STATUSES = ['archived', 'ended', 'ending'];

/** Load an archived relationship the caller is a member of, or send an error. */
const loadArchived = async (req, res) => {
  const { relationshipId } = req.params;
  const relationship = await Relationship.findById(relationshipId);
  if (!relationship) {
    res.status(404).json({ success: false, message: 'Chapter not found' });
    return null;
  }
  if (!relationship.isMember(req.user._id)) {
    res.status(403).json({ success: false, message: 'Not authorized' });
    return null;
  }
  if (!ARCHIVED_STATUSES.includes(relationship.status)) {
    res.status(400).json({
      success: false,
      message: 'This relationship is not archived',
      data: { status: Relationship.normalizeStatus(relationship.status) },
    });
    return null;
  }
  return relationship;
};

/** GET /api/archive — list the caller's past chapters. */
exports.listChapters = async (req, res) => {
  const rows = await Relationship.find({
    $or: [{ user1: req.user._id }, { user2: req.user._id }],
    status: { $in: ['archived', 'ended'] },
  })
    .populate('user1', 'name nickname profilePhoto')
    .populate('user2', 'name nickname profilePhoto')
    .sort({ archivedAt: -1, updatedAt: -1 });

  const includeHidden = req.query.includeHidden === '1';

  const chapters = await Promise.all(
    rows
      .filter((r) => {
        const hidden = (r.hiddenForUsers || []).some((u) => String(u) === String(req.user._id));
        return includeHidden || !hidden;
      })
      .map(async (r) => {
        const slot = r.slotFor(req.user._id);
        const partner = slot === 1 ? r.user2 : r.user1;
        const [msgCount, photoCount, tree] = await Promise.all([
          Message.countDocuments({ relationshipId: r._id, isDeleted: false }),
          Photo.countDocuments({ relationshipId: r._id, isDeleted: false }),
          LoveTree.findOne({ relationshipId: r._id }).lean(),
        ]);
        const start = r.startDate || r.createdAt;
        const end = r.archivedAt || r.endedAt || r.updatedAt;
        const days = Math.max(
          0,
          Math.floor((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24))
        );
        return {
          relationshipId: r._id,
          partner: partner
            ? { _id: partner._id, name: partner.name, nickname: partner.nickname, profilePhoto: partner.profilePhoto }
            : null,
          startDate: start,
          endedAt: end,
          daysTogether: days,
          messages: msgCount,
          photos: photoCount,
          // Frozen — points never decay in the archive.
          loveTree: tree
            ? { points: tree.points || 0, stage: tree.stage, frozen: true, stageInfo: resolveStageInfo(tree.points) }
            : null,
          isHidden: (r.hiddenForUsers || []).some((u) => String(u) === String(req.user._id)),
          purgeScheduledAt: r.purgeScheduledAt,
          reconciliationCount: r.reconciliationCount || 0,
          retentionMonths: ARCHIVE_RETENTION_MONTHS,
        };
      })
  );

  res.json({ success: true, data: { chapters } });
};

/** GET /api/archive/:relationshipId — one chapter's summary. */
exports.getChapter = async (req, res) => {
  const relationship = await loadArchived(req, res);
  if (!relationship) return;

  const slot = relationship.slotFor(req.user._id);
  const partnerId = slot === 1 ? relationship.user2 : relationship.user1;

  const [partner, tree, level, stats, timeline] = await Promise.all([
    User.findById(partnerId).select('name nickname profilePhoto').lean(),
    LoveTree.findOne({ relationshipId: relationship._id }).lean(),
    RelationshipLevel.findOne({ relationshipId: relationship._id }).lean(),
    statsService.getStats(relationship._id),
    TimelineEvent.find({ relationshipId: relationship._id, isDeleted: false })
      .sort({ eventDate: -1 })
      .limit(50)
      .lean(),
  ]);

  res.json({
    success: true,
    data: {
      relationshipId: relationship._id,
      status: Relationship.normalizeStatus(relationship.status),
      partner,
      startDate: relationship.startDate || relationship.createdAt,
      endedAt: relationship.archivedAt || relationship.endedAt,
      loveTree: tree ? { ...tree, frozen: true, stageInfo: resolveStageInfo(tree.points) } : null,
      level,
      stats,
      timeline,
      readOnly: true,
      purgeScheduledAt: relationship.purgeScheduledAt,
      isHidden: (relationship.hiddenForUsers || []).some((u) => String(u) === String(req.user._id)),
    },
  });
};

/** GET /api/archive/:relationshipId/messages — read-only, paginated. */
exports.getMessages = async (req, res) => {
  const relationship = await loadArchived(req, res);
  if (!relationship) return;

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const query = { relationshipId: relationship._id, isDeleted: false };
  if (req.query.search) query.content = { $regex: String(req.query.search).slice(0, 100), $options: 'i' };
  if (req.query.before) query.createdAt = { $lt: new Date(req.query.before) };

  const [messages, total] = await Promise.all([
    Message.find(query)
      .populate('senderId', 'name nickname profilePhoto bubbleColor')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Message.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: { messages: messages.reverse(), total, page, readOnly: true },
  });
};

/** GET /api/archive/:relationshipId/photos */
exports.getPhotos = async (req, res) => {
  const relationship = await loadArchived(req, res);
  if (!relationship) return;

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));

  const [photos, total, albums] = await Promise.all([
    Photo.find({ relationshipId: relationship._id, isDeleted: false })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Photo.countDocuments({ relationshipId: relationship._id, isDeleted: false }),
    Album.find({ relationshipId: relationship._id }).lean(),
  ]);

  res.json({ success: true, data: { photos, albums, total, page, readOnly: true } });
};

/** GET /api/archive/:relationshipId/diary */
exports.getDiary = async (req, res) => {
  const relationship = await loadArchived(req, res);
  if (!relationship) return;

  // Private entries stay private to their author, even in the archive.
  const entries = await Diary.find({
    relationshipId: relationship._id,
    $or: [{ isPrivate: false }, { isPrivate: { $exists: false } }, { userId: req.user._id }],
  })
    .sort({ createdAt: -1 })
    .lean();

  res.json({ success: true, data: { entries, readOnly: true } });
};

/** GET /api/archive/:relationshipId/timeline */
exports.getTimeline = async (req, res) => {
  const relationship = await loadArchived(req, res);
  if (!relationship) return;
  const events = await TimelineEvent.find({ relationshipId: relationship._id, isDeleted: false })
    .sort({ eventDate: -1 })
    .lean();
  res.json({ success: true, data: { events, readOnly: true } });
};

/** PATCH /api/archive/:relationshipId/hide  Body: { hidden: boolean } */
exports.setHidden = async (req, res) => {
  const relationship = await loadArchived(req, res);
  if (!relationship) return;

  const { hidden } = req.body || {};
  if (typeof hidden !== 'boolean') {
    return res.status(400).json({ success: false, message: 'hidden must be boolean' });
  }

  const uid = String(req.user._id);
  const current = (relationship.hiddenForUsers || []).map(String);
  relationship.hiddenForUsers = hidden
    ? [...new Set([...current, uid])]
    : current.filter((u) => u !== uid);
  await relationship.save();

  res.json({
    success: true,
    message: hidden ? 'Chapter hidden. Nothing was deleted.' : 'Chapter visible again.',
    data: { isHidden: hidden },
  });
};

/**
 * POST /api/archive/:relationshipId/purge — schedule permanent deletion.
 * Body: { confirmName: string }
 *
 * Requires typing the partner's name, and still waits PURGE_DELAY_DAYS before
 * anything is destroyed. Cancellable throughout.
 */
exports.schedulePurge = async (req, res) => {
  const relationship = await loadArchived(req, res);
  if (!relationship) return;

  const slot = relationship.slotFor(req.user._id);
  const partnerId = slot === 1 ? relationship.user2 : relationship.user1;
  const partner = await User.findById(partnerId).select('name nickname').lean();

  const expected = (partner?.name || partner?.nickname || '').trim().toLowerCase();
  const given = String(req.body?.confirmName || '').trim().toLowerCase();
  if (!expected || given !== expected) {
    return res.status(400).json({
      success: false,
      message: "Please type your partner's name exactly to confirm.",
    });
  }

  if (relationship.purgeScheduledAt) {
    return res.json({
      success: true,
      message: 'Deletion is already scheduled.',
      data: { purgeScheduledAt: relationship.purgeScheduledAt },
    });
  }

  await relService.schedulePurge(relationship, req.user._id);

  res.json({
    success: true,
    message: `Scheduled for deletion in ${PURGE_DELAY_DAYS} days. You can cancel any time before then.`,
    data: {
      purgeScheduledAt: relationship.purgeScheduledAt,
      purgeDelayDays: PURGE_DELAY_DAYS,
      // Users will not assume this, so say it explicitly.
      note: 'Your partner keeps their own copy of what you shared.',
    },
  });
};

/** DELETE /api/archive/:relationshipId/purge — cancel a scheduled deletion. */
exports.cancelPurge = async (req, res) => {
  const relationship = await loadArchived(req, res);
  if (!relationship) return;
  if (!relationship.purgeScheduledAt) {
    return res.status(400).json({ success: false, message: 'No deletion is scheduled.' });
  }
  await relService.cancelPurge(relationship);
  res.json({ success: true, message: 'Deletion cancelled. Your memories are safe.' });
};

/**
 * GET /api/archive/:relationshipId/export?format=json|html
 *
 * Export is available in EVERY state, not only at breakup — gating it to the
 * moment of loss makes it feel like a hostage negotiation.
 */
exports.exportChapter = async (req, res) => {
  const { relationshipId } = req.params;
  const relationship = await Relationship.findById(relationshipId);
  if (!relationship) return res.status(404).json({ success: false, message: 'Not found' });
  if (!relationship.isMember(req.user._id)) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  const format = req.query.format === 'html' ? 'html' : 'json';
  const slot = relationship.slotFor(req.user._id);
  const partnerId = slot === 1 ? relationship.user2 : relationship.user1;

  const [me, partner, messages, photos, diary, capsules, timeline, goals, tree, level, stats] =
    await Promise.all([
      User.findById(req.user._id).select('name nickname email').lean(),
      User.findById(partnerId).select('name nickname').lean(),
      Message.find({ relationshipId, isDeleted: false })
        .populate('senderId', 'name nickname')
        .sort({ createdAt: 1 })
        .lean(),
      Photo.find({ relationshipId, isDeleted: false }).sort({ createdAt: 1 }).lean(),
      Diary.find({ relationshipId, $or: [{ isPrivate: false }, { userId: req.user._id }] })
        .sort({ createdAt: 1 })
        .lean(),
      TimeCapsule.find({ relationshipId }).sort({ createdAt: 1 }).lean(),
      TimelineEvent.find({ relationshipId, isDeleted: false }).sort({ eventDate: 1 }).lean(),
      Goal.find({ relationshipId }).lean(),
      LoveTree.findOne({ relationshipId }).lean(),
      RelationshipLevel.findOne({ relationshipId }).lean(),
      statsService.getStats(relationshipId),
    ]);

  const bundle = {
    exportedAt: new Date().toISOString(),
    exportedBy: { name: me?.name, nickname: me?.nickname, email: me?.email },
    partner: { name: partner?.name, nickname: partner?.nickname },
    relationship: {
      startDate: relationship.startDate,
      endedAt: relationship.archivedAt || relationship.endedAt || null,
      status: Relationship.normalizeStatus(relationship.status),
      daysTogether: stats?.daysTogether ?? null,
    },
    stats: stats
      ? {
          messages: stats.messages,
          calls: stats.calls,
          photos: stats.photos,
          memories: stats.memories,
          goals: stats.goals,
          loveTree: stats.loveTree,
          level: stats.level,
        }
      : null,
    loveTree: tree,
    level,
    messages: messages.map((m) => ({
      from: m.senderId?.nickname || m.senderId?.name || 'Unknown',
      content: m.content,
      type: m.type,
      mediaUrl: m.mediaUrl || null,
      sentAt: m.createdAt,
    })),
    photos: photos.map((p) => ({ url: p.url, caption: p.caption, createdAt: p.createdAt })),
    diary: diary.map((d) => ({ title: d.title, content: d.content, mood: d.mood, createdAt: d.createdAt })),
    capsules: capsules.map((c) => ({ title: c.title, unlockDate: c.unlockDate, isUnlocked: c.isUnlocked })),
    timeline: timeline.map((t) => ({ type: t.eventType, title: t.title, description: t.description, date: t.eventDate })),
    goals: goals.map((g) => ({ title: g.title, category: g.category, progress: g.progress })),
  };

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="twinsoul-export-${stamp}.json"`);
    return res.send(JSON.stringify(bundle, null, 2));
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="twinsoul-memories-${stamp}.html"`);
  res.send(renderHtmlExport(bundle));
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** A browsable offline "memory book" — the version people actually treasure. */
const renderHtmlExport = (b) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Our Story — ${esc(b.exportedBy.name)} &amp; ${esc(b.partner.name)}</title>
<style>
  :root { --bg:#fffafc; --fg:#2b2230; --muted:#8a7f92; --accent:#ec4899; --card:#fff; --line:#f3e4ec; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#17121c; --fg:#f3eef7; --muted:#a99cb5; --accent:#f472b6; --card:#211a28; --line:#332a3c; }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:820px; margin:0 auto; padding:48px 20px 96px; }
  header { text-align:center; padding:56px 0 40px; border-bottom:1px solid var(--line); }
  h1 { margin:0 0 8px; font-size:2.1rem; font-weight:650; letter-spacing:-.02em; }
  .sub { color:var(--muted); }
  h2 { margin:56px 0 16px; font-size:1.3rem; font-weight:620;
       padding-bottom:8px; border-bottom:1px solid var(--line); }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin:28px 0; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; text-align:center; }
  .stat b { display:block; font-size:1.5rem; color:var(--accent); }
  .stat span { font-size:.8rem; color:var(--muted); }
  .msg { padding:9px 14px; margin:7px 0; background:var(--card);
         border:1px solid var(--line); border-left:3px solid var(--accent);
         border-radius:0 12px 12px 0; }
  .msg .who { font-weight:600; font-size:.82rem; color:var(--accent); }
  .msg .when { float:right; font-size:.72rem; color:var(--muted); }
  .entry { background:var(--card); border:1px solid var(--line);
           border-radius:14px; padding:18px; margin:14px 0; }
  .entry h3 { margin:0 0 6px; font-size:1rem; }
  .gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; }
  .gallery figure { margin:0; }
  .gallery img { width:100%; aspect-ratio:1; object-fit:cover; border-radius:12px; display:block; }
  .gallery figcaption { font-size:.75rem; color:var(--muted); margin-top:4px; }
  .tl { list-style:none; padding:0; margin:0; }
  .tl li { padding:12px 0 12px 20px; border-left:2px solid var(--line); position:relative; }
  .tl li::before { content:''; position:absolute; left:-6px; top:18px; width:10px; height:10px;
                   border-radius:50%; background:var(--accent); }
  footer { margin-top:72px; padding-top:24px; border-top:1px solid var(--line);
           text-align:center; color:var(--muted); font-size:.85rem; }
</style></head><body><div class="wrap">
<header>
  <h1>${esc(b.exportedBy.nickname || b.exportedBy.name)} &amp; ${esc(b.partner.nickname || b.partner.name)}</h1>
  <p class="sub">${fmtDate(b.relationship.startDate)}${b.relationship.endedAt ? ` — ${fmtDate(b.relationship.endedAt)}` : ' — present'}</p>
  ${b.relationship.daysTogether != null ? `<p class="sub">${b.relationship.daysTogether} days together</p>` : ''}
</header>

<div class="stats">
  ${b.stats ? `
  <div class="stat"><b>${b.stats.messages?.total ?? 0}</b><span>messages</span></div>
  <div class="stat"><b>${Math.round((b.stats.calls?.totalSeconds ?? 0) / 3600)}</b><span>hours on calls</span></div>
  <div class="stat"><b>${b.stats.photos?.total ?? 0}</b><span>photos</span></div>
  <div class="stat"><b>${b.stats.memories?.diaryEntries ?? 0}</b><span>diary entries</span></div>
  <div class="stat"><b>${b.loveTree?.points ?? 0}</b><span>love tree points</span></div>
  <div class="stat"><b>${b.stats.goals?.completed ?? 0}</b><span>goals completed</span></div>` : ''}
</div>

${b.timeline.length ? `<h2>Our timeline</h2><ul class="tl">${b.timeline
  .map((t) => `<li><strong>${esc(t.title)}</strong><br><span class="sub">${fmtDate(t.date)}</span>${t.description ? `<br>${esc(t.description)}` : ''}</li>`)
  .join('')}</ul>` : ''}

${b.photos.length ? `<h2>Photos (${b.photos.length})</h2><div class="gallery">${b.photos
  .map((p) => `<figure><img src="${esc(p.url)}" alt="${esc(p.caption || 'memory')}" loading="lazy">${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}</figure>`)
  .join('')}</div>` : ''}

${b.diary.length ? `<h2>Diary (${b.diary.length})</h2>${b.diary
  .map((d) => `<div class="entry"><h3>${esc(d.title || 'Untitled')}</h3><p class="sub">${fmtDate(d.createdAt)}${d.mood ? ` · ${esc(d.mood)}` : ''}</p><p>${esc(d.content).replace(/\n/g, '<br>')}</p></div>`)
  .join('')}` : ''}

${b.messages.length ? `<h2>Messages (${b.messages.length})</h2>${b.messages
  .map((m) => `<div class="msg"><span class="who">${esc(m.from)}</span><span class="when">${fmtDate(m.sentAt)}</span><div>${esc(m.content)}${m.mediaUrl ? ` <a href="${esc(m.mediaUrl)}">[media]</a>` : ''}</div></div>`)
  .join('')}` : ''}

<footer>Exported from TwinSoul on ${fmtDate(b.exportedAt)}<br>This is your copy. It works offline, forever.</footer>
</div></body></html>`;

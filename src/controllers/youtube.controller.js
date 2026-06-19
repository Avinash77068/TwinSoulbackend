const { Innertube } = require('youtubei.js');

// Single shared instance — Innertube.create() is expensive, reuse it
let youtube = null;

const getYoutube = async () => {
  if (!youtube) {
    youtube = await Innertube.create();
  }
  return youtube;
};

// GET /api/youtube/search?q=...
exports.search = async (req, res) => {
  const { q } = req.query;
  if (!q || !q.trim()) {
    return res.status(400).json({ success: false, message: 'Query required' });
  }

  const yt = await getYoutube();
  const results = await yt.search(q.trim());

  const videos = (results.results ?? [])
    .slice(0, 12)
    .map(v => ({
      id: v.id,
      title: v.title?.text ?? 'Untitled',
      thumbnail: v.thumbnails?.[0]?.url ?? null,
    }))
    .filter(v => v.id);

  res.json({ success: true, data: { videos } });
};

// GET /api/youtube/trending — getTrending deprecated, fallback to popular search
exports.trending = async (req, res) => {
  const yt = await getYoutube();
  const year = new Date().getFullYear();
  const results = await yt.search(`trending music videos ${year}`);

  const videos = (results.results ?? [])
    .slice(0, 12)
    .map(v => ({
      id: v.id,
      title: v.title?.text ?? 'Untitled',
      thumbnail: v.thumbnails?.[0]?.url ?? null,
    }))
    .filter(v => v.id);

  res.json({ success: true, data: { videos } });
};

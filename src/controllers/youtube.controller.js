const { Innertube } = require('youtubei.js');

let youtubePromise = null;
const getYoutube = () => youtubePromise ??= Innertube.create();

const mapVideo = (v) => ({
  id: v.id,
  title: v.title?.text ?? 'Untitled',
  thumbnail: v.thumbnails?.[0]?.url ?? null,
});

// GET /api/youtube/search?q=...
exports.search = async (req, res) => {
  const { q } = req.query;
  if (!q?.trim()) {
    return res.status(400).json({ success: false, message: 'Query required' });
  }

  const yt = await getYoutube();
  const results = await yt.search(q.trim());

  const videos = (results.results ?? [])
    .slice(0, 12)
    .map(mapVideo)
    .filter(v => v.id);

  res.json({ success: true, data: { videos } });
};

// GET /api/youtube/trending
exports.trending = async (req, res) => {
  const yt = await getYoutube();
  const year = new Date().getFullYear();
  const results = await yt.search(`trending music videos ${year}`);

  const videos = (results.results ?? [])
    .slice(0, 12)
    .map(mapVideo)
    .filter(v => v.id);

  res.json({ success: true, data: { videos } });
};

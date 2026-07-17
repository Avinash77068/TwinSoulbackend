let youtubePromise = null;

const getYoutube = async () => {
  if (!youtubePromise) {
    const { Innertube } = await import('youtubei.js');
    youtubePromise = Innertube.create();
  }

  return youtubePromise;
};

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

  try {
    const yt = await getYoutube();
    const results = await yt.search(q.trim());

    const videos = (results.results ?? [])
      .slice(0, 12)
      .map(mapVideo)
      .filter(v => v.id);

    res.json({ success: true, data: { videos } });
  } catch (error) {
    console.error('YouTube search error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch YouTube results' });
  }
};

// GET /api/youtube/trending
exports.trending = async (req, res) => {
  try {
    const yt = await getYoutube();
    const year = new Date().getFullYear();
    const results = await yt.search(`trending music videos ${year}`);

    const videos = (results.results ?? [])
      .slice(0, 12)
      .map(mapVideo)
      .filter(v => v.id);

    res.json({ success: true, data: { videos } });
  } catch (error) {
    console.error('YouTube trending error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch YouTube results' });
  }
};

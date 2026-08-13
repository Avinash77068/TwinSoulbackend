const youtubeService = require('../services/youtube.service');

/**
 * Thin HTTP layer over youtube.service.
 *
 * Validation, provider selection, timeouts and normalisation all live in the
 * service. This only maps results and failures onto status codes. Upstream
 * detail is logged server-side and never returned, so a YouTube outage cannot
 * leak internals to the app.
 */

const handleFailure = (res, err, context) => {
  if (err?.name === 'ValidationError') {
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err instanceof youtubeService.YouTubeUnavailableError) {
    // 503, not 500: the request was fine, the upstream provider is not — and
    // the app retries a 503 rather than treating it as a bad request.
    return res.status(503).json({
      success: false,
      message: 'YouTube is unavailable right now. Please try again.',
    });
  }
  console.error(`[YouTube] unexpected ${context} failure:`, err);
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
};

/** GET /api/youtube/search?q=&limit=&pageToken= */
exports.search = async (req, res) => {
  try {
    const data = await youtubeService.searchVideos({
      query: req.query.q,
      limit: req.query.limit,
      pageToken: req.query.pageToken,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return handleFailure(res, err, 'search');
  }
};

/** GET /api/youtube/trending?limit= */
exports.trending = async (req, res) => {
  try {
    const data = await youtubeService.trendingVideos({ limit: req.query.limit });
    return res.json({ success: true, data });
  } catch (err) {
    return handleFailure(res, err, 'trending');
  }
};

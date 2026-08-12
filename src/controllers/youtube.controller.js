const youtubeService = require('../services/youtube.service');

/**
 * Thin HTTP layer over youtube.service.
 *
 * All validation, provider selection, timeouts and normalisation live in the
 * service; this only maps results and failures onto status codes. Upstream
 * error details are logged server-side and never returned to the app, so a
 * YouTube outage cannot leak internals to a client.
 */

const respond = (res, payload) => res.json({ success: true, data: payload });

const handleFailure = (res, err, context) => {
  if (err?.name === 'ValidationError') {
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err instanceof youtubeService.YouTubeUnavailableError) {
    // 503: the request was fine, the upstream provider is not.
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
    const result = await youtubeService.searchVideos({
      query: req.query.q,
      limit: req.query.limit,
      pageToken: req.query.pageToken,
    });
    return respond(res, result);
  } catch (err) {
    return handleFailure(res, err, 'search');
  }
};

/** GET /api/youtube/trending?limit= */
exports.trending = async (req, res) => {
  try {
    const result = await youtubeService.trendingVideos({ limit: req.query.limit });
    return respond(res, result);
  } catch (err) {
    return handleFailure(res, err, 'trending');
  }
};

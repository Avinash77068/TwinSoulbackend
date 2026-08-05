const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const { upload, handleR2Upload } = require('../middleware/upload');
const c = require('../controllers/photos.controller');

router.get('/', protect, active, c.getPhotos);
router.post('/upload', protect, active, upload.single('photo'), handleR2Upload, c.uploadPhoto);
router.delete('/:id', protect, active, c.deletePhoto);
router.put('/:id/favorite', protect, active, c.toggleFavorite);
router.post('/:id/comment', protect, active, c.addComment);
router.delete('/:id/comment/:commentId', protect, active, c.deleteComment);
router.get('/favorites', protect, active, c.getFavoritePhotos);
router.get('/search', protect, active, c.searchPhotos);
router.get('/map', protect, active, c.getMemoryMap);
router.get('/albums', protect, active, c.getAlbums);
router.post('/albums', protect, active, c.createAlbum);
router.put('/albums/:id', protect, active, c.updateAlbum);
router.delete('/albums/:id', protect, active, c.deleteAlbum);
router.get('/albums/:id/photos', protect, active, c.getAlbumPhotos);

module.exports = router;

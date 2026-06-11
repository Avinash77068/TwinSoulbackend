const router = require('express').Router();
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const c = require('../controllers/photos.controller');

router.get('/', protect, c.getPhotos);
router.post('/upload', protect, upload.single('photo'), c.uploadPhoto);
router.delete('/:id', protect, c.deletePhoto);
router.put('/:id/favorite', protect, c.toggleFavorite);
router.post('/:id/comment', protect, c.addComment);
router.delete('/:id/comment/:commentId', protect, c.deleteComment);
router.get('/favorites', protect, c.getFavoritePhotos);
router.get('/search', protect, c.searchPhotos);
router.get('/map', protect, c.getMemoryMap);
router.get('/albums', protect, c.getAlbums);
router.post('/albums', protect, c.createAlbum);
router.put('/albums/:id', protect, c.updateAlbum);
router.delete('/albums/:id', protect, c.deleteAlbum);
router.get('/albums/:id/photos', protect, c.getAlbumPhotos);

module.exports = router;

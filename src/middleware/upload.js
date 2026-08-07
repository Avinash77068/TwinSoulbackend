const multer = require('multer');
const path = require('path');
const { uploadToCloud } = require('../config/cloudinary');

const IMAGE_EXT = /jpeg|jpg|png|gif|webp|heic|heif/;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Images only — video is not a supported attachment type.
 *
 * The mimetype decides and the extension is only a fallback. Requiring BOTH to
 * match, as this once did, rejected valid camera-roll files: iOS supplies
 * .HEIC and some Android pickers supply no extension at all.
 */
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = String(file.mimetype || '');
  if (mime.startsWith('image/') || (ext && IMAGE_EXT.test(ext))) return cb(null, true);
  cb(new Error('Only image files are allowed'));
};

// Memory storage — buffer uploaded to Cloudinary in handleCloudUpload
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_IMAGE_BYTES },
});

/**
 * After multer collects the file into memory, uploads to Cloudinary.
 * Sets req.file.cloudUrl = Cloudinary CDN URL.
 * Usage: [upload.single('photo'), handleCloudUpload, controller]
 */
const handleCloudUpload = async (req, res, next) => {
  if (!req.file) return next();
  try {
    const url = await uploadToCloud(
      req.file.buffer,
      String(req.user._id),
      req.file.mimetype,
    );
    req.file.cloudUrl = url;
    next();
  } catch (err) {
    next(new Error(`Upload failed: ${err.message}`));
  }
};

// Keep old name as alias so existing route imports don't break
const handleR2Upload = handleCloudUpload;

const handleMultiCloudUpload = async (req, res, next) => {
  if (!req.files || req.files.length === 0) return next();
  try {
    const urls = await Promise.all(
      req.files.map(f => uploadToCloud(f.buffer, String(req.user._id), f.mimetype)),
    );
    req.uploadedUrls = urls;
    next();
  } catch (err) {
    next(new Error(`Upload failed: ${err.message}`));
  }
};

module.exports = {
  upload,
  handleCloudUpload,
  handleR2Upload,
  handleMultiCloudUpload,
  MAX_IMAGE_BYTES,
};

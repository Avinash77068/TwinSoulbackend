const multer = require('multer');
const path = require('path');
const { uploadToCloud } = require('../config/cloudinary');

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp/;
  const ext = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) return cb(null, true);
  cb(new Error('Only image files are allowed'));
};

// Memory storage — buffer uploaded to Cloudinary in handleCloudUpload
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
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

module.exports = { upload, handleCloudUpload, handleR2Upload };

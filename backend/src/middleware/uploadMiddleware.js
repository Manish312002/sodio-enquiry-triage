/**
 * Multer file-upload middleware for the Phase 2 import endpoint.
 *
 * Architechure.md §8 — POST /api/enquiries/import accepts multipart/form-data.
 *
 * Constraints (Rules.md §13 File Handling):
 *   - Reasonable max file size: 5 MiB (sample fixture is 8 KB).
 *   - Reject unsupported file types: accept .txt only (the canonical parser
 *     input per Docs/memory.md). PDFs must be converted to .txt first via
 *     `pdftotext -layout` (the operator already did this — see test-data/).
 *   - Single file per request.
 *
 * Memory storage is used (no disk writes) because the parser is a pure
 * function over a UTF-8 string. The file content is decoded and passed to
 * parserService.parseEnquiryFile().
 */
import multer from 'multer';
import { AppError } from './errorHandler.js';

/** Max upload size: 5 MiB. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Allowed MIME types and corresponding extensions. */
const ALLOWED_MIME = new Set([
  'text/plain',
  'application/octet-stream', // some clients send this for .txt; we also check ext
  'text/markdown',
]);

const ALLOWED_EXT = new Set(['.txt', '.text', '.md']);

/**
 * File filter — reject anything that isn't a plain-text file.
 * Returns a multer callback (err, accepted).
 */
function fileFilter(_req, file, cb) {
  const originalName = file?.originalname || '';
  const lowerName = originalName.toLowerCase();
  const ext = lowerName.slice(lowerName.lastIndexOf('.'));

  const mimeOk = ALLOWED_MIME.has(file?.mimetype || '');
  const extOk = ALLOWED_EXT.has(ext);

  if (mimeOk || extOk) {
    return cb(null, true);
  }

  return cb(
    new AppError({
      message: `Unsupported file type: ${file?.mimetype || 'unknown'} (${originalName}). Allowed: ${[...ALLOWED_EXT].join(', ')}`,
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    }),
  );
}

/**
 * Single-file upload middleware. Use as:
 *   router.post('/import', upload.single('file'), controller.importEnquiries)
 *
 * Field name is `file` (per Architechure.md §8 convention).
 */
export const uploadSingleEnquiryFile = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
  fileFilter,
});

/**
 * Wrap multer errors so they flow through the central error handler with
 * a readable message. Mount this AFTER upload.single('file') on the route.
 *
 * Usage:
 *   router.post('/import',
 *     uploadSingleEnquiryFile.single('file'),
 *     handleUploadErrors,
 *     controller.importEnquiries);
 */
export function handleUploadErrors(err, _req, _res, next) {
  if (!err) return next();
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return next(
      new AppError({
        message: `Uploaded file is too large (max ${MAX_UPLOAD_BYTES} bytes).`,
        status: 413,
        code: 'FILE_TOO_LARGE',
      }),
    );
  }
  if (err?.code === 'LIMIT_FILE_COUNT') {
    return next(
      new AppError({
        message: 'Only one file may be uploaded per request.',
        status: 400,
        code: 'TOO_MANY_FILES',
      }),
    );
  }
  if (err?.code === 'LIMIT_UNEXPECTED_FILE') {
    return next(
      new AppError({
        message: `Unexpected upload field: ${err.field}. Use field name 'file'.`,
        status: 400,
        code: 'UNEXPECTED_FIELD',
      }),
    );
  }
  // AppError (e.g. from fileFilter) flows through unchanged.
  return next(err);
}

export default { uploadSingleEnquiryFile, handleUploadErrors, MAX_UPLOAD_BYTES };

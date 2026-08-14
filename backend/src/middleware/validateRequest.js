/**
 * Request validation middleware factory.
 *
 * Uses zod schemas to validate req.body / req.params / req.query.
 * On failure, responds 400 with a readable error shape.
 *
 *: file is scaffolded; no route consumes it yet (will).
 */
import { z } from 'zod';
import { AppError } from './errorHandler.js';

/**
 * @param {object} schemas
 * @param {z.ZodTypeAny} [schemas.body]
 * @param {z.ZodTypeAny} [schemas.params]
 * @param {z.ZodTypeAny} [schemas.query]
 */
export function validateRequest({ body, params, query } = {}) {
  return (req, _res, next) => {
    try {
      if (body) req.body = body.parse(req.body);
      if (params) req.params = params.parse(req.params);
      if (query) req.query = query.parse(req.query);
      next();
    } catch (err) {
      const message =
        err?.issues?.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') ||
        'Invalid request';
      next(
        new AppError({
          message,
          status: 400,
          code: 'VALIDATION_ERROR',
          context: { zodIssues: err?.issues?.length || 0 },
        }),
      );
    }
  };
}

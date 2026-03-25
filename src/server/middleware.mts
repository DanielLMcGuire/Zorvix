import { MAX_HEADERS_COUNT, MAX_URL_LENGTH } from '#zorvix/internal-types';
import type { RequestHandler } from '#zorvix/api-types';

/** Default body size ceiling: 1 MiB. */
const DEFAULT_BODY_LIMIT = 1_048_576;

/**
 * Returns middleware that logs every incoming request as `Client: METHOD URL`.
 * Register this first so the log line appears before any other processing.
 */
export function createLoggingMiddleware(): RequestHandler {
    return function loggingMiddleware(req, _res, next) {
        console.log(`Client: ${req.method} ${req.url}`);
        return next();
    };
}

/**
 * Returns middleware that short-circuits requests with an oversized URL (414)
 * or an excessive number of headers (431) before they reach the router or
 * static file handler.
 */
export function createGuardMiddleware(logging: boolean): RequestHandler {
    return function guardMiddleware(req, res, next) {
        if ((req.url?.length ?? 0) > MAX_URL_LENGTH) {
            res.writeHead(414, { 'Content-Type': 'text/plain' });
            res.end('414 URI Too Long');
            if (logging) console.log(
                `Server: 414 (URL too long: ${req.url?.length} bytes) ${req.url?.slice(0, 80)}…`,
            );
            return;
        }

        if (Object.keys(req.headers).length > MAX_HEADERS_COUNT) {
            res.writeHead(431, { 'Content-Type': 'text/plain' });
            res.end('431 Request Header Fields Too Large');
            if (logging) console.log(
                `Server: 431 (${Object.keys(req.headers).length} headers) ${req.url}`,
            );
            return;
        }

        return next();
    };
}

export interface BodyParserOptions {
    /**
     * Maximum number of bytes accepted in the request body.
     * Requests that exceed this limit are rejected with **413 Content Too Large**.
     * Default: `1_048_576` (1 MiB).
     */
    limit?: number;
}

/**
 * Returns middleware that reads and parses the request body for mutating HTTP
 * methods (POST, PUT, PATCH, DELETE), then attaches the result to `req.body`.
 *
 * Two content types are supported:
 * - **`application/json`** — parsed with `JSON.parse`; malformed JSON replies 400.
 * - **`application/x-www-form-urlencoded`** — parsed with the platform
 *   `URLSearchParams` API; the result is a plain `Record<string, string>`
 *   (multi-value keys collapse to their last value, matching conventional
 *   form behaviour).
 *
 * Requests with any other `Content-Type`, and all GET / HEAD / OPTIONS
 * requests, pass through unchanged with `req.body` left as `undefined`.
 *
 * @example Register globally
 * ```ts
 * server.use(createBodyParser());
 * ```
 *
 * @example Custom size limit (512 KiB)
 * ```ts
 * server.use(createBodyParser({ limit: 524_288 }));
 * ```
 *
 * @example Route-scoped
 * ```ts
 * server.use('/api', createBodyParser());
 *
 * server.post('/api/users', (req, res) => {
 *     const { name, email } = req.body as { name: string; email: string };
 *     res.json({ created: true });
 * });
 * ```
 */
export function createBodyParser(options?: BodyParserOptions): RequestHandler {
    const limit = options?.limit ?? DEFAULT_BODY_LIMIT;

    return function bodyParserMiddleware(req, res, next): void {
        const method = (req.method ?? 'GET').toUpperCase();

        // Body is meaningless (and often absent) for these methods — skip.
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
            next(); return;
        }

        const rawContentType = req.headers['content-type'] ?? '';
        const contentType    = rawContentType.split(';')[0].trim().toLowerCase();

        if (contentType !== 'application/json' &&
            contentType !== 'application/x-www-form-urlencoded') {
            next(); return;
        }

        // Reject oversized bodies early if Content-Length is present.
        const declaredLength = parseInt(req.headers['content-length'] ?? '0', 10);
        if (!Number.isNaN(declaredLength) && declaredLength > limit) {
            res.writeHead(413, { 'Content-Type': 'text/plain' });
            res.end('413 Content Too Large');
            return;
        }

        const chunks: Buffer[] = [];
        let received = 0;
        let aborted  = false;

        req.on('data', (chunk: Buffer) => {
            if (aborted) return;
            received += chunk.length;
            if (received > limit) {
                aborted = true;
                req.destroy();
                if (!res.headersSent) {
                    res.writeHead(413, { 'Content-Type': 'text/plain' });
                    res.end('413 Content Too Large');
                }
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            if (aborted) return;

            const raw = Buffer.concat(chunks).toString('utf-8');

            try {
                if (contentType === 'application/json') {
                    req.body = JSON.parse(raw);
                } else {
                    // URLSearchParams handles percent-decoding and `+` → space.
                    req.body = Object.fromEntries(new URLSearchParams(raw));
                }
            } catch {
                if (!res.headersSent) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('400 Bad Request: Malformed body');
                }
                return;
            }

            next();
        });

        req.on('error', () => {
            if (!aborted && !res.headersSent) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('400 Bad Request');
            }
        });
    };
}

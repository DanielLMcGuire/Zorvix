import http                               from 'node:http';
import https                              from 'https';
import crypto                             from 'crypto';
import path                               from 'path';
import fs                                 from 'node:fs';
import cluster                            from 'cluster';
import { fileURLToPath }                  from 'url';
import { IncomingMessage, ServerResponse } from 'node:http';
import { createCache }                    from '#zorvix/cache';
import { createDevToolsHandler }          from '#zorvix/devtools';
import { createRouter, normaliseMountPath } from '#zorvix/router';
import { createStaticHandler }            from '#zorvix/static';
import { createLoggingMiddleware, createGuardMiddleware } from '#zorvix/middleware';
import { createPrimaryInstance }          from '#zorvix/cluster';
import { resolvePem }                     from '#zorvix/tls';
import { HEADERS_TIMEOUT_MS, REQUEST_TIMEOUT_MS, MAX_HEADERS_COUNT, SHUTDOWN_GRACE_MS } from '#zorvix/internal-types';
import type { ServerOptions, ServerInstance, RequestHandler } from '#zorvix/api-types';
export { createBodyParser } from '#zorvix/middleware';

/**
 * Cluster-safe application entrypoint.
 *
 * When `workers` is `true` and the current process is the cluster primary,
 * the primary forks and supervises a worker without ever invoking `setup` —
 * so no user code (DB connections, route registration, etc.) runs in the
 * primary process.  In all other cases (single-process or inside a worker)
 * `setup` is called immediately with a fully configured {@link ServerInstance}.
 *
 * Use this instead of {@link createServer} when `workers: true`.  For tests
 * and single-process usage {@link createServer} remains the right choice.
 *
 * @param options - Configuration options for the server.
 * @param setup   - When `workers` is `false` (the default): a callback invoked
 *   with the configured {@link ServerInstance}.  Call `server.start()` inside
 *   the callback to begin accepting connections.
 *
 *   When `workers` is `true`: a **resolved absolute module path** whose default
 *   export is a `(server: ServerInstance) => void | Promise<void>` function.
 *   The module is dynamically imported by the worker process — no `eval`, no
 *   function serialisation.  Use
 *   `fileURLToPath(new URL('./your-app.js', import.meta.url))` to obtain a
 *   portable absolute path at the call site.
 *
 * @example Single-process (workers: false, default)
 * ```ts
 * serve({ port: 3000 }, async (server) => {
 *     server.get('/hello', (req, res) => res.end('Hello!'));
 *     await server.start();
 * });
 * ```
 *
 * @example Cluster mode (workers: true)
 * ```ts
 * // app.ts — the setup module (default export)
 * export default async function(server: ServerInstance) {
 *     await db.connect();
 *     server.get('/users', async (req, res) => {
 *         res.json(await db.query('SELECT * FROM users'));
 *     });
 *     await server.start();
 * }
 *
 * // entry.ts — the entry point
 * import { serve } from 'zorvix';
 * import { fileURLToPath } from 'url';
 *
 * serve(
 *     { port: 3000, workers: true },
 *     fileURLToPath(new URL('./app.js', import.meta.url)),
 * );
 * ```
 */
export function serve(
    options: ServerOptions,
    setup:   string | ((server: ServerInstance) => void | Promise<void>),
): void | Promise<void> {
    const { workers = false } = options;

    if (workers && cluster.isPrimary) {
        if (typeof setup !== 'string') {
            throw new TypeError(
                '[zorvix] serve(): When workers is true, `setup` must be a module path string.\n' +
                'Move your setup callback into a separate file with a default export, then pass\n' +
                'its path: serve(options, fileURLToPath(new URL("./app.js", import.meta.url)))',
            );
        }

        // Resolve to an absolute path and verify the file exists before storing
        // anything in the environment — never store executable code in env vars.
        const resolvedPath = path.resolve(setup);
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(
                `[zorvix] serve(): Setup module not found at path: "${resolvedPath}"`,
            );
        }

        const root = options.root ? path.resolve(options.root) : process.cwd();
        const workerBootstrap = fileURLToPath(
            new URL('./worker-bootstrap.min.mjs', import.meta.url),
        );
        cluster.setupPrimary({ exec: workerBootstrap });

        // Store a plain filesystem path — not serialised code — in the environment.
        process.env.ZORVIX_OPTIONS      = JSON.stringify({ ...options, workers: false });
        process.env.ZORVIX_SETUP_MODULE = resolvedPath;

        createPrimaryInstance(options.port, root).start().catch(console.error);

        return;
    }

    // Single-process mode or inside a worker: setup must be a callback function.
    if (typeof setup !== 'function') {
        throw new TypeError(
            '[zorvix] serve(): When workers is false (or not set), ' +
            '`setup` must be a function.',
        );
    }

    const server = createServer(options);
    const setupResult = setup(server);

    if (workers) {
        return new Promise(() => {
            Promise.resolve(setupResult).catch(err => {
                console.error('Server: Unhandled error in setup:', err);
                process.exit(1);
            });
        });
    }

    return Promise.resolve(setupResult);
}


/**
 * Creates and configures a Zorvix HTTP or HTTPS server.
 *
 * Handles static file serving, request routing, optional TLS, cluster worker
 * spawning, an in-memory file cache, and an optional DevTools endpoint.
 *
 * @example
 * ```ts
 * const server = createServer({ port: 3000, logging: true });
 *
 * server.get('/hello', (req, res) => {
 *     res.end('Hello, world!');
 * });
 *
 * await server.start();
 * ```
 *
 * @example JSON and query params
 * ```ts
 * // GET /search?q=zorvix&tag=fast&tag=small
 * server.get('/search', (req, res) => {
 *     // req.query → { q: 'zorvix', tag: ['fast', 'small'] }
 *     res.json({ results: [] });
 * });
 * ```
 *
 * @example Body parsing
 * ```ts
 * import { createBodyParser } from '#zorvix/middleware';
 *
 * server.use(createBodyParser());
 *
 * server.post('/users', (req, res) => {
 *     const { name } = req.body as { name: string };
 *     res.json({ created: name }, 201);
 * });
 * ```
 *
 * @example TLS
 * ```ts
 * const server = createServer({
 *     port: 443,
 *     key:  './certs/server.key',
 *     cert: './certs/server.crt',
 * });
 * ```
 *
 * @param options - Configuration options for the server.
 * @returns A {@link ServerInstance} that exposes route registration and
 *   lifecycle methods.
 */
export function createServer(options: ServerOptions): ServerInstance {
    const { port, logging = false, devTools = false, workers = false, cache = true } = options;
    const root = options.root ? path.resolve(options.root) : process.cwd();

    if (workers && cluster.isPrimary) {
        return createPrimaryInstance(port, root);
    }

    const useTls = !!(options.key && options.cert);
    const tlsContext = useTls
        ? { key: resolvePem(options.key!), cert: resolvePem(options.cert!) }
        : undefined;

    const { getFile, startPruning } = createCache(root, logging, cache);

    const devToolsUUID   = devTools ? crypto.randomUUID() : null;
    const handleDevTools = devToolsUUID
        ? createDevToolsHandler(root, devToolsUUID, logging)
        : null;

    const serveStatic = createStaticHandler(root, getFile, handleDevTools, logging);
    const router = createRouter(logging);

    if (logging) router.addMiddleware(null, createLoggingMiddleware());
    router.addMiddleware(null, createGuardMiddleware(logging));

    const httpServer = useTls
        ? https.createServer(tlsContext!, handleRequest)
        : http.createServer(handleRequest);

    httpServer.headersTimeout  = HEADERS_TIMEOUT_MS;
    httpServer.requestTimeout  = REQUEST_TIMEOUT_MS;
    httpServer.maxHeadersCount = MAX_HEADERS_COUNT;

    async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        req.params = {};

        const rawQuery = req.url?.split('?')[1] ?? '';
        const qp       = new URLSearchParams(rawQuery);
        const query: Record<string, string | string[]> = {};
        for (const key of new Set(qp.keys())) {
            const vals   = qp.getAll(key);
            query[key] = vals.length === 1 ? vals[0] : vals;
        }
        req.query = query;

        res.json = function jsonHelper(data: unknown, status = 200): void {
            const body = JSON.stringify(data);
            if (!this.headersSent) {
                this.writeHead(status, {
                    'Content-Type':   'application/json',
                    'Content-Length': Buffer.byteLength(body),
                });
            }
            this.end(body);
        };

        res.html = function htmlHelper(markup: string, status = 200): void {
            if (!this.headersSent) {
                this.writeHead(status, {
                    'Content-Type':   'text/html; charset=utf-8',
                    'Content-Length': Buffer.byteLength(markup),
                });
            }
            this.end(markup);
        };

        try {
            await router.dispatch(req, res, serveStatic);
        } catch (err) {
            console.error('Server: Unhandled error in request handler:', err);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 Internal Server Error');
            }
        }
    }

    let isListening = false;

    function addRoute(method: string, routePath: string, handler: RequestHandler): ServerInstance {
        router.addRoute(method, routePath, handler);
        return instance;
    }

    function use(handler: RequestHandler): ServerInstance;
    function use(mountPath: string, handler: RequestHandler): ServerInstance;
    function use(pathOrHandler: string | RequestHandler, maybeHandler?: RequestHandler): ServerInstance {
        if (typeof pathOrHandler === 'function') {
            router.addMiddleware(null, pathOrHandler);
        } else {
            if (!maybeHandler) throw new TypeError('use(path, handler): handler is required');
            router.addMiddleware(normaliseMountPath(pathOrHandler), maybeHandler);
        }
        return instance;
    }

    const instance: ServerInstance = {
        get root()      { return root; },
        get port()      { return port; },
        get listening() { return isListening; },
        get server()    { return httpServer; },

        use,

        get    (routePath, handler) { return addRoute('GET',     routePath, handler); },
        post   (routePath, handler) { return addRoute('POST',    routePath, handler); },
        put    (routePath, handler) { return addRoute('PUT',     routePath, handler); },
        patch  (routePath, handler) { return addRoute('PATCH',   routePath, handler); },
        delete (routePath, handler) { return addRoute('DELETE',  routePath, handler); },
        head   (routePath, handler) { return addRoute('HEAD',    routePath, handler); },
        options(routePath, handler) { return addRoute('OPTIONS', routePath, handler); },

        start(): Promise<void> {
            if (isListening) return Promise.reject(new Error('Server is already listening'));
            return new Promise((resolve, reject) => {
                httpServer.once('error', reject);
                httpServer.listen(port, () => {
                    httpServer.off('error', reject);
                    isListening = true;
                    startPruning();
                    resolve();
                });
            });
        },

        stop(): Promise<void> {
            if (!isListening) return Promise.resolve();
            isListening = false;
            return new Promise((resolve, reject) => {
                httpServer.close((err) => {
                    if (err) { reject(err); return; }
                    resolve();
                });

                httpServer.closeIdleConnections();

                setTimeout(
                    () => httpServer.closeAllConnections(),
                    SHUTDOWN_GRACE_MS,
                ).unref();
            });
        },
    };

    return instance;
}

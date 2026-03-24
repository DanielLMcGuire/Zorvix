import http              from 'http';
import https             from 'https';
import fs                from 'fs';
import crypto            from 'crypto';
import path              from 'path';
import { IncomingMessage, ServerResponse } from 'http';
import { createCache }   from '#server/cache';
import { createDevToolsHandler } from '#server/devtools';
import { serveBufferFile, serveStreamFile } from '#server/serve';
import { isAttachment, cacheControlFor }    from '#server/mime';
import { HEADERS_TIMEOUT_MS, REQUEST_TIMEOUT_MS } from '#server/types';

export type RequestHandler = (
    req:  IncomingMessage,
    res:  ServerResponse,
    next: () => void | Promise<void>,
) => void | Promise<void>;

export interface ServerOptions {
    /** Port to listen on. */
    port:      number;
    /**
     * Directory to serve files from.
     * Defaults to `process.cwd()`.
     */
    root?:     string;
    /** Log requests and cache activity to stdout. Default: `false`. */
    logging?:  boolean;
    /** Enable Chrome DevTools workspace integration. Default: `false`. */
    devTools?: boolean;
    /**
     * Path to a PEM-encoded TLS private key file.
     * Must be supplied together with `cert` to enable HTTPS.
     */
    key?:      string;
    /**
     * Path to a PEM-encoded TLS certificate file.
     * Must be supplied together with `key` to enable HTTPS.
     */
    cert?:     string;
}

export interface ServerInstance {
    /**
     * Register a request handler that runs *before* static-file serving.
     * Handlers are called in registration order; call `next()` to continue
     * the chain.  Returns `this` for chaining.
     */
    use(handler: RequestHandler): this;

    /**
     * Start listening.  Resolves once the server is bound and ready to accept
     * connections.  Rejects if the port is already in use or another OS error
     * occurs.
     */
    start(): Promise<void>;

    /**
     * Gracefully stop the server.  Resolves once all in-flight connections are
     * closed.
     */
    stop(): Promise<void>;

    /** The resolved absolute path being served. */
    readonly root:   string;
    /** The port passed to `createServer`. */
    readonly port:   number;
    /** The underlying `http.Server` or `https.Server` instance, in case you need low-level access. */
    readonly server: http.Server | https.Server;
}

function resolveFilePath(url: string | undefined, root: string): string | null {
    const raw = !url || url === '/' ? '/index.html' : url.split('?')[0];

    let decoded: string;
    try {
        decoded = decodeURIComponent(raw);
    } catch {
        return null;
    }

    const resolved = path.resolve(root, '.' + decoded);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
    return resolved;
}

export function createServer(options: ServerOptions): ServerInstance {
    const { port, logging = false, devTools = false } = options;
    const ROOT = options.root ? path.resolve(options.root) : process.cwd();

    const handlers: RequestHandler[] = [];

    const { getFile, startPruning } = createCache(ROOT, logging);

    const devToolsUUID   = devTools ? crypto.randomUUID() : null;
    const handleDevTools = devToolsUUID
        ? createDevToolsHandler(ROOT, devToolsUUID, logging)
        : null;

    const useTls = !!(options.key && options.cert);
    let tlsContext: { key: Buffer; cert: Buffer } | undefined;
    if (useTls) {
        tlsContext = {
            key:  fs.readFileSync(options.key!),
            cert: fs.readFileSync(options.cert!),
        };
    }

    async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const method = req.method ?? 'GET';

        if (handleDevTools &&
            req.url?.split('?')[0].endsWith('/.well-known/appspecific/com.chrome.devtools.json')) {
            handleDevTools(req, res, method);
            return;
        }

        const filepath = resolveFilePath(req.url, ROOT);

        if (!filepath) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('400 Bad Request');
            if (logging) console.log(`Server: 400 (traversal/bad URL) ${req.url}`);
            return;
        }

        const fileData = await getFile(filepath);

        if (!fileData) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            if (logging) console.log(`Server: 404 ${req.url}`);
            return;
        }

        if (logging) console.log(`Server: Serving ${path.relative(ROOT, filepath)}`);

        const ext            = path.extname(filepath);
        const clientEtag     = req.headers['if-none-match'];
        const clientModified = req.headers['if-modified-since'];

        const etagMatch     = clientEtag && clientEtag === fileData.etag;
        const modifiedMatch = !clientEtag && clientModified &&
            new Date(clientModified) >= new Date(fileData.lastModified);

        if (etagMatch || modifiedMatch) {
            res.writeHead(304, {
                'ETag':          fileData.etag,
                'Last-Modified': fileData.lastModified,
                'Cache-Control': cacheControlFor(ext),
            });
            res.end();
            if (logging) console.log(`Server: 304 ${req.url}`);
            return;
        }

        const baseHeaders: Record<string, string | number> = {
            'Content-Type':  fileData.contentType,
            'ETag':          fileData.etag,
            'Last-Modified': fileData.lastModified,
            'Cache-Control': cacheControlFor(ext),
            'Accept-Ranges': 'bytes',
        };

        if (isAttachment(ext)) {
            const filename = encodeURIComponent(path.basename(filepath));
            baseHeaders['Content-Disposition'] =
                `attachment; filename="${filename}"; filename*=UTF-8''${filename}`;
        }

        const rangeHeader = req.headers['range'];
        const ifRange     = req.headers['if-range'];
        const honorRange  = !!rangeHeader && (!ifRange || ifRange === fileData.etag);
        const acceptsGzip = req.headers['accept-encoding']?.includes('gzip') ?? false;

        if ('buffer' in fileData) {
            serveBufferFile(req, res, fileData, baseHeaders, method,
                rangeHeader, honorRange, acceptsGzip, logging);
        } else {
            serveStreamFile(req, res, fileData, baseHeaders, method, ext,
                rangeHeader, honorRange, acceptsGzip, logging, ROOT);
        }
    }

    async function runHandlers(
        req:   IncomingMessage,
        res:   ServerResponse,
        index: number,
    ): Promise<void> {
        if (index >= handlers.length) {
            await serveStatic(req, res);
            return;
        }
        await handlers[index](req, res, () => runHandlers(req, res, index + 1));
    }

    const httpServer = useTls
        ? https.createServer(tlsContext!, async (req, res) => handler(req, res))
        : http.createServer(async (req, res) => handler(req, res));

    async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const method = req.method ?? 'GET';

        if (logging) console.log(`Client: ${req.method} ${req.url}`);

        if (method !== 'GET' && method !== 'HEAD') {
            res.writeHead(405, { Allow: 'GET, HEAD' });
            res.end();
            return;
        }

        try {
            await runHandlers(req, res, 0);
        } catch (err) {
            console.error('Server: Unhandled error in request handler:', err);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 Internal Server Error');
            }
        }
    }

    httpServer.headersTimeout = HEADERS_TIMEOUT_MS;
    httpServer.requestTimeout = REQUEST_TIMEOUT_MS;

    const instance: ServerInstance = {
        get root()   { return ROOT; },
        get port()   { return port; },
        get server() { return httpServer; },

        use(handler: RequestHandler): ServerInstance {
            handlers.push(handler);
            return instance;
        },

        start(): Promise<void> {
            return new Promise((resolve, reject) => {
                httpServer.once('error', reject);
                httpServer.listen(port, () => {
                    httpServer.off('error', reject);
                    startPruning();
                    if (logging) {
                        const protocol  = useTls ? 'https' : 'http';
                        const defaultPort = useTls ? 443 : 80;
                        console.log(
                            port !== defaultPort
                                ? `Server running at ${protocol}://localhost:${port}/`
                                : `Server running at ${protocol}://localhost/`
                        );
                    }
                    resolve();
                });
            });
        },

        stop(): Promise<void> {
            return new Promise((resolve, reject) => {
                httpServer.close((err) => err ? reject(err) : resolve());
            });
        },
    };

    return instance;
}

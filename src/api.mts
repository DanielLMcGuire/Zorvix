import http                              from 'http';
import https                             from 'https';
import crypto                            from 'crypto';
import path                              from 'path';
import cluster                           from 'cluster';
import { IncomingMessage, ServerResponse } from 'http';
import { createCache }                   from '#zorvix/cache';
import { createDevToolsHandler }         from '#zorvix/devtools';
import { createRouter, normaliseMountPath } from '#zorvix/router';
import { createStaticHandler, rejectRequest } from '#zorvix/static';
import { createPrimaryInstance }         from '#zorvix/cluster';
import { resolvePem }                    from '#zorvix/tls';
import { HEADERS_TIMEOUT_MS, REQUEST_TIMEOUT_MS, MAX_HEADERS_COUNT } from '#zorvix/types';
import type { ServerOptions, ServerInstance, RequestHandler } from '#zorvix/api-types';

export type { NextFunction, RequestHandler, ServerOptions, ServerInstance } from '#zorvix/api-types';

declare module 'http' {
    interface IncomingMessage {
        params: Record<string, string>;
    }
}

export function createServer(options: ServerOptions): ServerInstance {
    const { port, logging = false, devTools = false, workers = false } = options;
    const root = options.root ? path.resolve(options.root) : process.cwd();

    if (workers && cluster.isPrimary) {
        return createPrimaryInstance(port, root);
    }

    const useTls = !!(options.key && options.cert);
    const tlsContext = useTls
        ? { key: resolvePem(options.key!), cert: resolvePem(options.cert!) }
        : undefined;

    const { getFile, startPruning } = createCache(root, logging);

    const devToolsUUID   = devTools ? crypto.randomUUID() : null;
    const handleDevTools = devToolsUUID
        ? createDevToolsHandler(root, devToolsUUID, logging)
        : null;

    const serveStatic = createStaticHandler(root, getFile, handleDevTools, logging);

    const router = createRouter(logging);

    const httpServer = useTls
        ? https.createServer(tlsContext!, handleRequest)
        : http.createServer(handleRequest);

    httpServer.headersTimeout  = HEADERS_TIMEOUT_MS;
    httpServer.requestTimeout  = REQUEST_TIMEOUT_MS;
    httpServer.maxHeadersCount = MAX_HEADERS_COUNT;

    async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        req.params = {};

        if (logging) console.log(`Client: ${req.method} ${req.url}`);

        if (rejectRequest(req, res, logging)) return;

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

    const instance: ServerInstance = {
        get root()      { return root; },
        get port()      { return port; },
        get listening() { return isListening; },
        get server()    { return httpServer; },

        use(pathOrHandler: string | RequestHandler, maybeHandler?: RequestHandler): ServerInstance {
            if (typeof pathOrHandler === 'function') {
                router.addMiddleware(null, pathOrHandler);
            } else {
                if (!maybeHandler) throw new TypeError('use(path, handler): handler is required');
                router.addMiddleware(normaliseMountPath(pathOrHandler), maybeHandler);
            }
            return instance;
        },

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
                    const protocol    = useTls ? 'https' : 'http';
                    const defaultPort = useTls ? 443 : 80;
                    console.log(
                        port !== defaultPort
                            ? `Server running at ${protocol}://localhost:${port}/`
                            : `Server running at ${protocol}://localhost/`,
                    );
                    resolve();
                });
            });
        },

        stop(): Promise<void> {
            if (!isListening) return Promise.resolve();
            return new Promise((resolve, reject) => {
                httpServer.close((err) => {
                    if (err) { reject(err); return; }
                    isListening = false;
                    resolve();
                });
            });
        },
    };

    return instance;
}

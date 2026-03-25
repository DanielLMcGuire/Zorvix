export interface WorkerOptions {
    port:         number;
    logging:      boolean;
    devTools:     boolean;
    hostRootArg?: string;
    isDev:        boolean;
    /** Absolute path to the TLS private-key file (PEM). Requires `tlsCert`. */
    tlsKey?:      string;
    /** Absolute path to the TLS certificate file (PEM). Requires `tlsKey`. */
    tlsCert?:     string;
}

export type CachedBuffer = {
    buffer:       Buffer;
    gzipped:      Buffer | null;
    contentType:  string;
    etag:         string;
    lastModified: string;
    cachedAt:     number;
};

export type CachedStream = {
    path:         string;
    size:         number;
    contentType:  string;
    etag:         string;
    lastModified: string;
    cachedAt:     number;
};

export type CachedFile = CachedBuffer | CachedStream;

export type ByteRange = { start: number; end: number };

/** A parsed Range header result.
 *  - `ByteRange`   – a single satisfiable range
 *  - `ByteRange[]` – two or more satisfiable ranges (multipart/byteranges)
 *  - `'not-satisfiable'` – RFC 7233 §4.4 error; send 416
 */
export type RangeResult = ByteRange | ByteRange[] | 'not-satisfiable';

export const MAX_CACHE_SIZE = 8_112 * 1024;  // ~8 MB
export const CACHE_TTL_MS   = 80_000;        // evict entries after 1.3 m

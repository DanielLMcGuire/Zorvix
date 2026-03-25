import fs                               from 'fs';
import path                             from 'path';
import zlib                             from 'zlib';
import crypto                           from 'crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import type { CachedBuffer, CachedStream, ByteRange } from '#zorvix/static-types';
import { isCompressible }               from '#zorvix/mime';
import { parseRange, handleRangeError } from '#zorvix/range';

function makeBoundary(): string {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Build a `multipart/byteranges` body for an in-memory buffer.
 * All slicing is synchronous.
 */
function buildBufferMultipart(
    ranges:      ByteRange[],
    totalSize:   number,
    contentType: string,
    boundary:    string,
    buf:         Buffer,
): Buffer {
    const parts: Buffer[] = [];
    for (const { start, end } of ranges) {
        parts.push(Buffer.from(
            `--${boundary}\r\n` +
            `Content-Type: ${contentType}\r\n` +
            `Content-Range: bytes ${start}-${end}/${totalSize}\r\n` +
            `\r\n`,
        ));
        parts.push(buf.subarray(start, end + 1));
        parts.push(Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(parts);
}

/** Read a specific byte range from a file into a Buffer. */
function readFileRange(filepath: string, start: number, end: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const stream = fs.createReadStream(filepath, { start, end });
        stream.on('data', (chunk: Buffer | string) =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        );
        stream.on('end',   () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

/**
 * Build a `multipart/byteranges` body for a file that is too large to be
 * cached. Each range is read sequentially from disk.
 */
async function buildStreamMultipart(
    ranges:      ByteRange[],
    totalSize:   number,
    contentType: string,
    boundary:    string,
    filepath:    string,
): Promise<Buffer> {
    const parts: Buffer[] = [];
    for (const { start, end } of ranges) {
        parts.push(Buffer.from(
            `--${boundary}\r\n` +
            `Content-Type: ${contentType}\r\n` +
            `Content-Range: bytes ${start}-${end}/${totalSize}\r\n` +
            `\r\n`,
        ));
        parts.push(await readFileRange(filepath, start, end));
        parts.push(Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(parts);
}

export function serveBufferFile(
    req:         IncomingMessage,
    res:         ServerResponse,
    fileData:    CachedBuffer,
    baseHeaders: Record<string, string | number>,
    method:      string,
    rangeHeader: string | undefined,
    honorRange:  boolean,
    acceptsGzip: boolean,
    logging:     boolean,
): void {
    const totalSize = fileData.buffer.byteLength;

    if (honorRange) {
        const range = parseRange(rangeHeader!, totalSize);

        if (range === 'not-satisfiable') {
            handleRangeError(res, totalSize, req.url, logging);
            return;
        }

        if (Array.isArray(range)) {
            const boundary = makeBoundary();
            const body     = buildBufferMultipart(
                range, totalSize, fileData.contentType, boundary, fileData.buffer,
            );
            res.writeHead(206, {
                ...baseHeaders,
                'Content-Type':   `multipart/byteranges; boundary=${boundary}`,
                'Content-Length': body.byteLength,
            });
            if (method !== 'HEAD') res.end(body);
            else                   res.end();
            return;
        }

        const { start, end } = range;
        const body = fileData.buffer.subarray(start, end + 1);
        res.writeHead(206, {
            ...baseHeaders,
            'Content-Range':  `bytes ${start}-${end}/${totalSize}`,
            'Content-Length': body.byteLength,
        });
        if (method !== 'HEAD') res.end(body);
        else                   res.end();

    } else if (acceptsGzip && fileData.gzipped) {
        const body = fileData.gzipped;
        res.writeHead(200, { ...baseHeaders, 'Content-Encoding': 'gzip', 'Content-Length': body.byteLength });
        if (method !== 'HEAD') res.end(body);
        else                   res.end();
    } else {
        const body = fileData.buffer;
        res.writeHead(200, { ...baseHeaders, 'Content-Length': body.byteLength });
        if (method !== 'HEAD') res.end(body);
        else                   res.end();
    }
}

export function serveStreamFile(
    req:         IncomingMessage,
    res:         ServerResponse,
    fileData:    CachedStream,
    baseHeaders: Record<string, string | number>,
    method:      string,
    ext:         string,
    rangeHeader: string | undefined,
    honorRange:  boolean,
    acceptsGzip: boolean,
    logging:     boolean,
    root:        string,
): void {
    const totalSize = fileData.size;

    if (honorRange) {
        const range = parseRange(rangeHeader!, totalSize);

        if (range === 'not-satisfiable') {
            handleRangeError(res, totalSize, req.url, logging);
            return;
        }

        if (Array.isArray(range)) {
            const boundary = makeBoundary();
            buildStreamMultipart(
                range, totalSize, fileData.contentType, boundary, fileData.path,
            ).then(body => {
                res.writeHead(206, {
                    ...baseHeaders,
                    'Content-Type':   `multipart/byteranges; boundary=${boundary}`,
                    'Content-Length': body.byteLength,
                });
                if (method !== 'HEAD') res.end(body);
                else                   res.end();
            }).catch(() => {
                if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
            });
            return;
        }

        const { start, end } = range;
        res.writeHead(206, {
            ...baseHeaders,
            'Content-Range':  `bytes ${start}-${end}/${totalSize}`,
            'Content-Length': end - start + 1,
        });
        if (method === 'HEAD') { res.end(); return; }
        const fileStream = fs.createReadStream(fileData.path, { start, end });
        fileStream.on('error', () => {
            if (!res.headersSent) res.statusCode = 500;
            res.end('Internal Server Error');
        });
        fileStream.pipe(res);

    } else if (method === 'HEAD') {
        res.writeHead(200, baseHeaders);
        res.end();
    } else if (acceptsGzip && isCompressible(ext)) {
        const compressStart = logging ? process.hrtime.bigint() : undefined;
        res.writeHead(200, { ...baseHeaders, 'Content-Encoding': 'gzip' });

        const gzip       = zlib.createGzip();
        const fileStream = fs.createReadStream(fileData.path);

        const onError = () => {
            if (!res.headersSent) res.statusCode = 500;
            res.end('Internal Server Error');
        };
        gzip.on('error', onError);
        fileStream.on('error', onError);
        gzip.on('finish', () => {
            if (logging && compressStart) {
                const ms = Number(process.hrtime.bigint() - compressStart) / 1e6;
                console.log(`Server: Compressed ${path.relative(root, fileData.path)} in ${ms.toFixed(3)}ms`);
            }
        });

        fileStream.pipe(gzip).pipe(res);
    } else {
        res.writeHead(200, baseHeaders);
        const fileStream = fs.createReadStream(fileData.path);
        fileStream.on('error', () => {
            if (!res.headersSent) res.statusCode = 500;
            res.end('Internal Server Error');
        });
        fileStream.pipe(res);
    }
}

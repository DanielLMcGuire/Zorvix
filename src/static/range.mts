import { ServerResponse }               from 'node:http';
import type { RangeResult, ByteRange }  from '#zorvix/static-types';

/**
 * Parse an RFC 7233 `Range: bytes=...` header.
 *
 * Returns:
 *  - `ByteRange`        – a single satisfiable range
 *  - `ByteRange[]`      – two or more satisfiable ranges
 *  - `'not-satisfiable'`– any spec is syntactically invalid or out of bounds
 */
export function parseRange(header: string, totalSize: number): RangeResult {
    const raw = header.trim();
    if (!raw.startsWith('bytes=')) return 'not-satisfiable';

    const specs  = raw.slice(6).split(',').map(s => s.trim());
    const ranges: ByteRange[] = [];

    for (const spec of specs) {
        const m = /^(\d*)-(\d*)$/.exec(spec);
        if (!m) return 'not-satisfiable';

        const hasStart = m[1] !== '';
        const hasEnd   = m[2] !== '';
        if (!hasStart && !hasEnd) return 'not-satisfiable';

        let start: number;
        let end:   number;

        if (!hasStart) {
            // suffix-range: bytes=-N  →  last N bytes
            const suffix = parseInt(m[2], 10);
            start = Math.max(0, totalSize - suffix);
            end   = totalSize - 1;
        } else {
            start = parseInt(m[1], 10);
            end   = hasEnd ? parseInt(m[2], 10) : totalSize - 1;
        }

        end = Math.min(end, totalSize - 1);
        if (start > end || start >= totalSize) return 'not-satisfiable';

        ranges.push({ start, end });
    }

    if (ranges.length === 0) return 'not-satisfiable';
    return ranges.length === 1 ? ranges[0] : ranges;
}

/** Send a 416 Range Not Satisfiable response. */
export function handleRangeError(
    res:       ServerResponse,
    totalSize: number,
    url:       string | undefined,
    logging:   boolean,
): void {
    res.writeHead(416, {
        'Content-Range': `bytes */${totalSize}`,
        'Content-Type':  'text/plain',
    });
    res.end('416 Range Not Satisfiable');
    if (logging) console.log(`Server: 416 ${url}`);
}

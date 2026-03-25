import { describe, it } from 'node:test';
import assert            from 'node:assert/strict';
import { parseRange }    from '#zorvix/range';

describe('parseRange', () => {

    it('returns a correct ByteRange for a simple bytes=start-end header', () => {
        assert.deepEqual(parseRange('bytes=0-499', 1000), { start: 0, end: 499 });
    });

    it('handles an open-ended range (no end byte)', () => {
        assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
    });

    it('clamps end to totalSize - 1 when the requested end exceeds the file', () => {
        assert.deepEqual(parseRange('bytes=0-9999', 500), { start: 0, end: 499 });
    });

    it('handles a suffix range (no start byte) — last N bytes', () => {
        assert.deepEqual(parseRange('bytes=-200', 1000), { start: 800, end: 999 });
    });

    it('suffix range larger than file returns the whole file', () => {
        assert.deepEqual(parseRange('bytes=-9999', 500), { start: 0, end: 499 });
    });

    it('handles a single-byte range', () => {
        assert.deepEqual(parseRange('bytes=0-0', 100), { start: 0, end: 0 });
    });

    it('handles the last byte of a file', () => {
        assert.deepEqual(parseRange('bytes=99-99', 100), { start: 99, end: 99 });
    });

    it('tolerates extra whitespace in the header value', () => {
        assert.deepEqual(parseRange('  bytes=0-9  ', 100), { start: 0, end: 9 });
    });

    it('returns not-satisfiable when start > end', () => {
        assert.equal(parseRange('bytes=500-100', 1000), 'not-satisfiable');
    });

    it('returns not-satisfiable when start equals totalSize', () => {
        assert.equal(parseRange('bytes=1000-1000', 1000), 'not-satisfiable');
    });

    it('returns not-satisfiable when start exceeds totalSize', () => {
        assert.equal(parseRange('bytes=5000-9999', 1000), 'not-satisfiable');
    });

    it('returns not-satisfiable for "bytes=-" (both parts empty)', () => {
        assert.equal(parseRange('bytes=-', 1000), 'not-satisfiable');
    });

    it('returns not-satisfiable for an unrecognised unit', () => {
        assert.equal(parseRange('chunks=0-10', 1000), 'not-satisfiable');
    });

    it('returns not-satisfiable for a completely malformed header', () => {
        assert.equal(parseRange('garbage', 1000), 'not-satisfiable');
    });

    it('handles a multi-range header with two ranges', () => {
        const result = parseRange('bytes=0-99,200-299', 1000);
        assert.deepEqual(result, [
            { start: 0, end: 99 },
            { start: 200, end: 299 }
        ]);
    });

    it('handles a multi-range header with three ranges', () => {
        const result = parseRange('bytes=0-49,100-149,200-249', 1000);
        assert.deepEqual(result, [
            { start: 0, end: 49 },
            { start: 100, end: 149 },
            { start: 200, end: 249 }
        ]);
    });

    it('handles mixed range types in multi-range header', () => {
        const result = parseRange('bytes=0-99,200-, -50', 1000);
        assert.deepEqual(result, [
            { start: 0, end: 99 },
            { start: 200, end: 999 },
            { start: 950, end: 999 }
        ]);
    });

    it('handles multi-range with whitespace', () => {
        const result = parseRange('bytes=0-99, 200-299, 400-499', 1000);
        assert.deepEqual(result, [
            { start: 0, end: 99 },
            { start: 200, end: 299 },
            { start: 400, end: 499 }
        ]);
    });

    it('handles multi-range where ranges overlap', () => {
        const result = parseRange('bytes=0-99,50-149', 1000);
        assert.deepEqual(result, [
            { start: 0, end: 99 },
            { start: 50, end: 149 }
        ]);
    });

    it('handles multi-range with out-of-bounds ranges', () => {
        const result = parseRange('bytes=0-99,900-1500', 1000);
        assert.deepEqual(result, [
            { start: 0, end: 99 },
            { start: 900, end: 999 }
        ]);
    });

    it('returns not-satisfiable for multi-range with invalid ranges', () => {
        assert.equal(parseRange('bytes=500-100,200-299', 1000), 'not-satisfiable');
    });

    it('returns not-satisfiable for multi-range with start exceeding totalSize', () => {
        assert.equal(parseRange('bytes=0-99,2000-2999', 1000), 'not-satisfiable');
    });
});
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

    it('returns not-implemented for a multi-range header', () => {
        assert.equal(parseRange('bytes=0-99,200-299', 1000), 'not-implemented');
    });

    it('returns not-implemented for any header containing a comma', () => {
        assert.equal(parseRange('bytes=0-499,500-999', 1000), 'not-implemented');
    });
});

import { describe, it }                                               from 'node:test';
import assert                                                         from 'node:assert/strict';
import { getMimeType, isCompressible, isAttachment, cacheControlFor } from '#zorvix/mime';


describe('getMimeType', () => {
    it('returns text/html for .html', () => {
        assert.equal(getMimeType('.html'), 'text/html');
    });

    it('is case-insensitive (.HTML → same as .html)', () => {
        assert.equal(getMimeType('.HTML'), getMimeType('.html'));
    });

    it('returns a javascript MIME type for .js', () => {
        assert.match(getMimeType('.js'), /javascript/);
    });

    it('returns application/json for .json', () => {
        assert.equal(getMimeType('.json'), 'application/json');
    });

    it('returns image/png for .png', () => {
        assert.equal(getMimeType('.png'), 'image/png');
    });

    it('returns an image/jpeg-family MIME type for .jpg', () => {
        assert.match(getMimeType('.jpg'), /image\/.*(jpeg|jpg|pjpeg)/);
    });

    it('returns an image/jpeg-family MIME type for .jpeg', () => {
        assert.match(getMimeType('.jpeg'), /image\/.*(jpeg|jpg|pjpeg)/);
    });

    it('returns image/svg+xml for .svg', () => {
        assert.equal(getMimeType('.svg'), 'image/svg+xml');
    });

    it('returns application/pdf for .pdf', () => {
        assert.equal(getMimeType('.pdf'), 'application/pdf');
    });

    it('falls back to application/octet-stream for unknown extensions', () => {
        assert.equal(getMimeType('.unknown_ext_xyz'), 'application/octet-stream');
    });

    it('falls back to application/octet-stream for an empty string', () => {
        assert.equal(getMimeType(''), 'application/octet-stream');
    });
});

describe('isCompressible', () => {
    const mustBeCompressible = ['.html', '.htm', '.css', '.json', '.xml', '.svg', '.txt', '.csv'];
    for (const ext of mustBeCompressible) {
        it(`returns true for ${ext}`, () => {
            assert.equal(isCompressible(ext), true);
        });
    }

    it('returns true for .js (whatever its exact MIME type)', () => {
        assert.equal(isCompressible('.js'), true);
    });

    const mustNotBeCompressible = ['.png', '.jpg', '.gif', '.webp', '.woff2', '.pdf', '.ico'];
    for (const ext of mustNotBeCompressible) {
        it(`returns false for ${ext}`, () => {
            assert.equal(isCompressible(ext), false);
        });
    }

    it('returns false for an unknown extension', () => {
        assert.equal(isCompressible('.unknown_ext_xyz'), false);
    });
});

describe('isAttachment', () => {
    const mustBeAttachment = ['.tar', '.gz', '.exe', '.jar', '.docx', '.xlsx', '.pptx', '.iso', '.dmg'];
    for (const ext of mustBeAttachment) {
        it(`returns true for ${ext}`, () => {
            assert.equal(isAttachment(ext), true);
        });
    }

    it('returns true for .zip (whatever its exact MIME type)', () => {
        assert.equal(isAttachment('.zip'), true);
    });

    const mustNotBeAttachment = ['.html', '.css', '.js', '.json', '.png', '.jpg', '.svg', '.txt'];
    for (const ext of mustNotBeAttachment) {
        it(`returns false for ${ext}`, () => {
            assert.equal(isAttachment(ext), false);
        });
    }

    it('returns false for an unknown extension', () => {
        assert.equal(isAttachment('.unknown_ext_xyz'), false);
    });
});

describe('cacheControlFor', () => {
    it('returns no-cache for .html', () => {
        assert.equal(cacheControlFor('.html'), 'no-cache');
    });

    it('returns no-cache for .htm', () => {
        assert.equal(cacheControlFor('.htm'), 'no-cache');
    });

    it('returns no-cache for .txt', () => {
        assert.equal(cacheControlFor('.txt'), 'no-cache');
    });

    it('returns no-cache for .json', () => {
        assert.equal(cacheControlFor('.json'), 'no-cache');
    });

    it('returns a revalidation directive for .css', () => {
        assert.match(cacheControlFor('.css'), /must-revalidate/);
    });

    it('returns a revalidation directive for .js', () => {
        assert.match(cacheControlFor('.js'), /must-revalidate/);
    });

    it('returns a revalidation directive for unknown extensions', () => {
        assert.match(cacheControlFor('.wasm'), /must-revalidate/);
    });
});

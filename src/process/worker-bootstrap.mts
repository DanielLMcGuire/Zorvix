/**
 * Internal cluster worker bootstrap.
 *
 * This file is set as the worker exec target via `cluster.setupPrimary({ exec })`,
 * so forked workers run this instead of the caller's entry point.  It
 * deserialises the options and setup callback that the primary wrote into the
 * environment and calls them directly against a fresh ServerInstance.
 */
import { createServer } from '#zorvix/api';
import type { ServerOptions } from '#zorvix/api-types';

const options = JSON.parse(process.env.ZORVIX_OPTIONS!) as ServerOptions;

// eval reconstructs the setup arrow/function from its serialised source.
// This works for any self-contained callback; it won't capture outer-scope
// variables from the caller's module, but server setup callbacks should be
// self-contained by design.
const setup = eval(`(${process.env.ZORVIX_SETUP!})`);

Promise.resolve(setup(createServer(options))).catch((err: unknown) => {
    console.error('Server: Unhandled error in setup:', err);
    process.exit(1);
});

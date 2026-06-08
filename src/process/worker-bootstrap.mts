/**
 * Internal cluster worker bootstrap.
 *
 * This file is set as the worker exec target via `cluster.setupPrimary({ exec })`,
 * so forked workers run this instead of the caller's entry point.  It reads a
 * validated module path from ZORVIX_SETUP_MODULE and dynamically imports it,
 * calling the default-exported setup function with a fresh ServerInstance.
 *
 * No eval() is used.  The module path is a plain resolved filesystem path that
 * was validated by serve() in the primary before being written to the environment.
 */
import { createServer } from '#zorvix/api';
import type { ServerOptions, ServerInstance } from '#zorvix/api-types';

const options = JSON.parse(process.env.ZORVIX_OPTIONS!) as ServerOptions;

const modulePath = process.env.ZORVIX_SETUP_MODULE;
if (!modulePath) {
    console.error('[zorvix] ZORVIX_SETUP_MODULE is not set — cannot start worker.');
    process.exit(1);
}

// Dynamically import the user's plugin module — no eval, no arbitrary code
// execution from env.  The path was already resolved and validated (existsSync)
// by serve() in the primary process before being stored in the environment.
let pluginModule: { default?: (server: ServerInstance) => void | Promise<void> };
try {
    pluginModule = await import(modulePath) as typeof pluginModule;
} catch (err) {
    console.error(`[zorvix] Failed to import setup module "${modulePath}":`, err);
    process.exit(1);
}

const setup = pluginModule.default;
if (typeof setup !== 'function') {
    console.error(
        `[zorvix] Setup module "${modulePath}" must export a default function ` +
        '(e.g. `export default async function(server) { ... }`).',
    );
    process.exit(1);
}

Promise.resolve(setup(createServer(options))).catch((err: unknown) => {
    console.error('Server: Unhandled error in setup:', err);
    process.exit(1);
});

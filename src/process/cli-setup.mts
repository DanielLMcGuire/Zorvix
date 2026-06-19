import type { ServerInstance } from '#zorvix/api-types';

/**
 * Default-exported setup function used by zorvix's built-in CLI in cluster
 * (workers) mode.  The cluster primary passes the compiled path of this module
 * to `serve()`, and the worker bootstrap dynamically imports it and calls this
 * function with a freshly created {@link ServerInstance}.
 *
 * In `--dev` mode the CLI skips workers entirely and calls `server.start()`
 * inline instead, so this file is only loaded inside worker processes.
 */
export default async function cliSetup(server: ServerInstance): Promise<void> {
    await server.start();
}

import esbuild from 'esbuild';
import ts from 'typescript';
import { readdirSync, rmSync } from 'fs';

console.log('type checking');

const configPath = ts.findConfigFile('./', ts.sys.fileExists, 'tsconfig.json');
if (!configPath) throw new Error('tsconfig.json not found');

const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
if (error) throw new Error(ts.formatDiagnostic(error, ts.createCompilerHost({})));

const { options, fileNames, errors } = ts.parseJsonConfigFileContent(config, ts.sys, './');
if (errors.length) throw new Error(ts.formatDiagnostics(errors, ts.createCompilerHost({})));

const checkProgram = ts.createProgram(fileNames, { ...options, noEmit: true });
const diagnostics  = ts.getPreEmitDiagnostics(checkProgram);
const KEEP = new Set(['api.d.mts', 'types.d.mts']);

if (diagnostics.length) {
    const host = {
        getCurrentDirectory:  () => ts.sys.getCurrentDirectory(),
        getCanonicalFileName: (f) => f,
        getNewLine:           () => '\n',
    };
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
    process.exit(1);
}

console.log('emitting declarations');

const declOptions = {
    ...options,
    noEmit:              false,
    emitDeclarationOnly: true,
    declaration:         true,
    rootDir:             'src',
    declarationDir:      'dist',
    outDir:              'dist',
};

const declProgram = ts.createProgram(['src/api.mts'], declOptions);
const emitResult  = declProgram.emit();

if (emitResult.diagnostics.length) {
    const host = {
        getCurrentDirectory:  () => ts.sys.getCurrentDirectory(),
        getCanonicalFileName: (f) => f,
        getNewLine:           () => '\n',
    };
    console.error(ts.formatDiagnosticsWithColorAndContext(
        ts.sortAndDeduplicateDiagnostics(emitResult.diagnostics), host
    ));
    process.exit(1);
}

for (const file of readdirSync('dist')) {
    if (file.endsWith('.d.mts') && !KEEP.has(file)) {
        rmSync(`dist/${file}`);
    }
}

console.log('compiling and bundling');
await Promise.all([
    esbuild.build({
        entryPoints: ['src/server.mts'],
        bundle:      true,
        minify:      true,
        platform:    'node',
        format:      'esm',
        outfile:     'dist/server.min.mjs',
        banner:      { js: '#!/usr/bin/env node' },
    }),
    esbuild.build({
        entryPoints: ['src/api.mts'],
        bundle:      true,
        minify:      true,
        platform:    'node',
        format:      'esm',
        outfile:     'dist/api.min.mjs',
    }),
]);
console.log('done');

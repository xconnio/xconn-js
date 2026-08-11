import typescript from '@rollup/plugin-typescript';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import json from '@rollup/plugin-json';
import dts from 'rollup-plugin-dts';

const input = 'lib/index.ts';

// Shim wampproto's bare `crypto` import for browser ESM bundles where Node.js
// built-ins are unavailable. globalThis.crypto is always present in browsers.
function cryptoBrowserShim() {
    const SHIM_ID = '\0crypto-browser-shim';
    return {
        name: 'crypto-browser-shim',
        resolveId(id) { if (id === 'crypto') return SHIM_ID; },
        load(id) {
            if (id !== SHIM_ID) return null;
            return `export const webcrypto = globalThis.crypto;
export const subtle = globalThis.crypto?.subtle;
export default { webcrypto: globalThis.crypto, subtle: globalThis.crypto?.subtle };`;
        },
    };
}

function sharedPlugins(resolveOpts) {
    return [
        replace({
            preventAssignment: true,
            'process.env.NODE_ENV': JSON.stringify('production'),
        }),
        nodeResolve(resolveOpts),
        commonjs(),
        json(),
        typescript({
            tsconfig: './tsconfig.json',
            declaration: false,
        }),
    ];
}

export default [
    // Browser ESM bundle: crypto → globalThis.crypto shim, no Node built-ins.
    // Consumed via the `browser` export condition by browser bundlers (Webpack, Vite, …).
    {
        input,
        output: {
            dir: 'ts-built',
            entryFileNames: 'browser.js',
            format: 'esm',
            sourcemap: true,
        },
        plugins: [
            cryptoBrowserShim(),
            ...sharedPlugins({browser: true, preferBuiltins: false}),
        ],
    },
    // Node ESM + CJS bundles: `crypto` stays external so Node resolves it natively
    // (built-in on all supported Node versions; no globalThis.crypto requirement).
    {
        input,
        output: [
            {
                dir: 'ts-built',
                format: 'esm',
                entryFileNames: '[name].js',
                sourcemap: true,
            },
            {
                dir: 'ts-built',
                format: 'cjs',
                entryFileNames: '[name].cjs',
                sourcemap: true,
                exports: 'auto',
            },
        ],
        plugins: sharedPlugins({preferBuiltins: true}),
        external: ['crypto'],
    },
    // Type declarations.
    {
        input,
        output: {
            file: 'ts-built/index.d.ts',
            format: 'es',
        },
        plugins: [dts()],
    },
];

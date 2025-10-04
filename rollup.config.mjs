import typescript from '@rollup/plugin-typescript';
import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import json from '@rollup/plugin-json';
import dts from 'rollup-plugin-dts';

const input = 'lib/index.ts';

export default [
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
        plugins: [
            replace({
                preventAssignment: true,
                'process.env.NODE_ENV': JSON.stringify('production'),
            }),
            nodeResolve({
                browser: true,
                preferBuiltins: true,
            }),
            commonjs(),
            json(),
            typescript({
                tsconfig: './tsconfig.json',
                declaration: false,
            }),
        ],
        external: [],
    },
    {
        input,
        output: {
            file: 'ts-built/index.d.ts',
            format: 'es',
        },
        plugins: [dts()],
    },
];

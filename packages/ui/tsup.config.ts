import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    tokens: 'src/tokens/index.ts',
    utils: 'src/utils/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Automatic JSX runtime — emit jsx/jsxs from react/jsx-runtime instead of
  // React.createElement, so the bundle needs no `React` global. The classic
  // transform would throw `React is not defined` under SSR/prerender.
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
  // React 19 + radix + every runtime dep stays external; consumers dedupe
  // against their own install. Bundling them would break hooks identity and
  // bloat the tarball.
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'tailwindcss',
    /^@radix-ui\//,
    'class-variance-authority',
    'clsx',
    'lucide-react',
    'motion',
    'sonner',
    'tailwind-merge',
    'vaul',
    'cmdk',
  ],
});

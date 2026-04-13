import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['packages/core/src/index.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  outDir: './dist',
  outExtension: () => ({ js: '.cjs' }),
  clean: true,
  bundle: true,
  noExternal: [/@pocket-relay\//],
  esbuildOptions(options) {
    options.external = ['fsevents'];
    options.banner = {
      js: '#!/usr/bin/env node',
    };
  },
});

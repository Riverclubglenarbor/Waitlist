// vitest.config.ts sets `test.globals: true`, which injects describe/it/
// expect/vi/beforeEach at runtime — but TypeScript needs this reference to
// know those globals exist, otherwise `npx tsc --noEmit` fails on every
// test file that uses them without importing from 'vitest'.
/// <reference types="vitest/globals" />

// Ambient shim for `three`. The Electrobun desktop runtime
// (electrobun/dist/api/bun/index.ts) imports `three`, which ships no type
// declarations, so `tsc --noImplicitAny` flags it through our `electrobun/`
// desktop bridge. `three` is never used by the studio's own code — only pulled
// transitively by Electrobun's bun API — so declaring it `any` here keeps the
// web typecheck green without depending on node_modules resolution.
declare module "three";

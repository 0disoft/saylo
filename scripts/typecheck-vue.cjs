// Resolve the isolated TS 6 toolchain without replacing the root TS 7 tsc binary.
const { createRequire } = require('node:module');
const path = require('node:path');
createRequire(path.resolve(__dirname, '../tools/vue/package.json'))('vue-tsc').run();

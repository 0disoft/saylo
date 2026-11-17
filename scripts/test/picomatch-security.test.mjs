import { createRequire } from 'node:module';
import { registerPicomatchSecurityTests } from '../pack-fixtures/picomatch-security.mjs';

registerPicomatchSecurityTests(createRequire(import.meta.url));

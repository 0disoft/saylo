import { fileURLToPath } from 'node:url';
import { renderTypes, writeGenerated } from '@saylo/typegen';
import { fixtureSchema } from './fixture.mjs';

await writeGenerated(fileURLToPath(new URL('./generated.d.ts', import.meta.url)), renderTypes([fixtureSchema]));

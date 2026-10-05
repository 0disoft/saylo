import { fileURLToPath } from 'node:url';
import { renderTypes, writeGenerated } from '@0disoft/saylo-typegen';
import { fixtureSchema } from './fixture.mjs';

await writeGenerated(fileURLToPath(new URL('./generated.d.ts', import.meta.url)), renderTypes([fixtureSchema]));

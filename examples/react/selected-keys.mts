import type { AppSchema } from './generated';

// Share this exact tuple between the Vite build and the typed screen contract.
export const demoKeys = Object.freeze([
  'demo:heading', 'demo:description', 'demo:formTitle',
  'demo:name', 'demo:namePlaceholder', 'demo:note', 'demo:notePlaceholder',
  'demo:count', 'demo:summary', 'demo:openDialog',
  'demo:dialogTitle', 'demo:dialogNote', 'demo:closeDialog', 'demo:rich',
] as const satisfies readonly (keyof AppSchema)[]);

export type DemoSchema = Pick<AppSchema, typeof demoKeys[number]>;

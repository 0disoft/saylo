import RichText from '@0disoft/saylo-svelte/RichText.svelte';
import type { Component, Snippet } from 'svelte';
import type { RichTextProps, RichTextRenderers } from '@0disoft/saylo-svelte';
import type { Translator } from '@0disoft/saylo-core';

const component: Component<RichTextProps> = RichText;
declare const strong: Snippet<[Snippet]>;
declare const snapshot: Translator<{ 'demo:rich': { name: string } }>;
const props: RichTextProps = { parts: snapshot.tParts('demo:rich', { name: 'Ada' }), renderers: { strong } };
void component; void props;
// @ts-expect-error component parts retain base argument types
snapshot.tParts('demo:rich', { name: false });
// @ts-expect-error element names cannot replace typed Svelte snippets
const badRenderers: RichTextRenderers = { strong: 'strong' };
void badRenderers;

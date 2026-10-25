import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTranslationPo, serializeTranslationPo } from '../dist/catalog-po.js';

const work = () => ({ format: 'saylo-translation-work/v3', baseLocale: 'en', entries: ['pending', 'empty', 'translated'].map((id, i) => ({
  locale: 'ko', namespace: 'common', id, reason: 'add', source: 'Line\n"\\u0000 한글 😀 {count, plural, one {one} other {#}}',
  sourceHash: 'a'.repeat(64), originalTranslation: null, translation: [null, '', '<link>{count}</link>'][i],
  context: { arguments: { count: ['number'] }, richTextTags: ['link'], metadata: { description: 'Context\nsecond line', maxLength: 100, glossary: { one: '단일' } } },
})) });

test('PO roundtrip preserves ICU, literal escapes, metadata, pending tasks and explicit empty translations', () => {
  const original = work();
  const text = serializeTranslationPo(original);
  assert.match(text, /Content-Type: text\/plain/);
  assert.deepEqual(parseTranslationPo(text, 'en'), original);
  assert.equal(original.entries[0].translation, null);
  const control = work(); control.entries[0].source = '\x00\b\t\r\n';
  assert.deepEqual(parseTranslationPo(serializeTranslationPo(control), 'en'), control);
});

test('gettext multiline fields and fuzzy drafts retain checkpoints without becoming approvals', () => {
  const original = work(); original.entries = [original.entries[2]];
  let text = serializeTranslationPo(original).replace('msgstr "<link>{count}</link>"', 'msgstr ""\n"<link>"\n"{count}</link>"');
  assert.deepEqual(parseTranslationPo(text, 'en'), original);
  text = text.replace('msgctxt ', '#, fuzzy\n\nmsgctxt ');
  assert.equal(parseTranslationPo(text, 'en').entries[0].translation, null);
});

test('PO refuses missing checkpoints, duplicate tasks, native plurals, malformed fields and wrong locales', () => {
  const original = work(); const text = serializeTranslationPo(original);
  for (const invalid of [text.replace(/^msgctxt .*\n/m, ''), text.replace('msgstr "<link>{count}</link>"', 'msgid_plural "plural"\nmsgstr[0] "x"'),
    text.replace('msgid "Line', 'msgid "bad"\nmsgid "Line'), text.replace('X-Saylo-Format:', 'X-Other-Format:'), text + '\n#~ msgid "old"'])
    assert.throws(() => parseTranslationPo(invalid, 'en'));
  assert.throws(() => parseTranslationPo(text, 'fr'));
  original.entries.push(original.entries[0]);
  assert.throws(() => serializeTranslationPo(original));
});

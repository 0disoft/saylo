import { createElement as h, useEffect, useState, useSyncExternalStore } from 'react';

const at = Date.parse('2026-01-01T00:30:00.000Z');
export function SsrProbe({ adapter, hydrated }) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot, adapter.getServerSnapshot);
  const [count, setCount] = useState(0);
  useEffect(() => { hydrated?.(); }, [hydrated]);
  return h('section', null,
    h('h1', { lang: snapshot.locale }, snapshot.t('demo:greeting', { name: 'Ada' })),
    h('p', { id: 'when' }, snapshot.t('demo:when', { at })),
    h('p', { id: 'rows' }, snapshot.t('demo:rows', { count: 21 })),
    h('input', { 'aria-label': 'draft', defaultValue: '' }),
    h('button', { onClick: () => setCount(value => value + 1) }, String(count)),
    h('dialog', { open: count > 0 }, 'confirmation'));
}

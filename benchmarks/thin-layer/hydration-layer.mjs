import { decodeBootSnapshot, CatalogLoadError, I18nDisposedError } from '@0disoft/saylo-core/runtime';
import { createCatalogLayer } from './catalog-layer.mjs';

// Experiment-only bridge: reuse Saylo's validated boot wire contract, then
// rebuild the i18next engine. i18next does not supply this hydration barrier.
export async function createHydrationLayer(json, options = {}) {
  const boot = decodeBootSnapshot(json);
  if (options.timeZone !== undefined) {
    const configured = new Intl.DateTimeFormat('en', { timeZone: options.timeZone }).resolvedOptions().timeZone;
    if (configured !== boot.timeZone) throw new CatalogLoadError('INVALID_BOOT', 'Configured timezone differs from boot.');
  }
  const catalogs = boot.catalogOutcomes.filter(outcome => outcome.status === 'present').map(outcome => outcome.catalog);
  const layer = await createCatalogLayer(boot.manifest.baseLocale, catalogs, boot.locale,
    { timeZone: boot.timeZone, availableLocales: boot.manifest.availableLocales });
  const serverSnapshot = layer.getSnapshot();
  let current = serverSnapshot, hydrating = true, disposed = false;
  const listeners = new Set();
  const alive = () => { if (disposed) throw new I18nDisposedError(); };
  const publish = () => {
    const next = layer.getSnapshot();
    if (next === current) return;
    current = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    getSnapshot: () => current,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener) { alive(); listeners.add(listener); return () => listeners.delete(listener); },
    async replace(catalogs, locale) {
      alive(); await layer.replace(catalogs, locale); alive();
      if (!hydrating) publish();
    },
    finishHydration() {
      if (disposed || !hydrating) return;
      hydrating = false; publish();
    },
    dispose() { disposed = true; listeners.clear(); },
  };
}

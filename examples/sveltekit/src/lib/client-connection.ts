import { connectDev, createDevCatalogSource } from '@0disoft/saylo-vite/client';
import type { LiveDiagnostic } from '@0disoft/saylo-vite/client';
import type { BootSnapshot, CatalogSource, I18n } from '@0disoft/saylo-core';
import type { AppSchema } from './generated';

export function connectBootClient(options: {
  boot: BootSnapshot;
  instance: I18n<AppSchema>;
  attachSource: (source: CatalogSource) => void;
  hot?: NonNullable<ImportMeta['hot']>;
  onDiagnostic?: (value: LiveDiagnostic) => void;
}) {
  let active = true;
  let disconnect: (() => void) | undefined;
  // Each dev layout owns a source seeded from its fresh request boot, even after re-entry.
  const owned = options.hot ? createDevCatalogSource(options.boot.manifest, options.boot.catalogOutcomes, { hot: options.hot }) : undefined;
  const source = owned ? Promise.resolve(owned) : import('virtual:saylo/lazy').then(module => module.catalogSource);
  const ready = source.then(async catalogSource => {
    if (!active) return false;
    options.attachSource(catalogSource);
    disconnect = connectDev(options.instance, { catalogSource,
      ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}) });
    await options.instance.refresh();
    return active;
  });
  const stop = () => {
    if (!active) return;
    active = false;
    try { disconnect?.(); } finally { owned?.dispose(); }
  };
  return { ready, stop };
}

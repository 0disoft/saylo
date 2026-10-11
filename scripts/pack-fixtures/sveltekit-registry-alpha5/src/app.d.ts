import type { SupportEnvironment } from '@0disoft/saylo-vite/client';
declare global {
  const __SAYLO_SUPPORT_ENV__: SupportEnvironment;
  namespace App {
    interface Locals { locale: string }
  }
}
export {};

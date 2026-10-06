import React from 'react';
import { createRoot } from 'react-dom/client';
import { Probe } from './app.jsx';
import { getLocale, setLocale } from './paraglide/runtime.js';

// Initial locale setup is outside measurement; fresh browser profiles start in en.
if (!sessionStorage.getItem('bench-locale-initialized')) {
  if (getLocale() !== 'en') await setLocale('en', { reload: false });
  sessionStorage.setItem('bench-locale-initialized', 'true');
}
createRoot(document.getElementById('root')).render(<Probe />);

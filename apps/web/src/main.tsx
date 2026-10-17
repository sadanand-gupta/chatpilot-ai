import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { warmApiOnLoad } from './lib/keepWarm';
import './index.css';

// Start waking the (free-tier, sleeping) API while the first page renders.
warmApiOnLoad();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

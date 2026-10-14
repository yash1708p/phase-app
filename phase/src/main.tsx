import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initPWA } from './lib/pwa';
import './index.css';

initPWA();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

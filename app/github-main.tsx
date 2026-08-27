import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import GoldFlowApp from './GoldFlowApp';
import './globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GoldFlowApp />
  </StrictMode>,
);

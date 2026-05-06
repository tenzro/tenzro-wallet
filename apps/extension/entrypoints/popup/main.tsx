import { TooltipProvider } from '@tenzro/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { App } from './App';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('No root');

createRoot(root).render(
  <StrictMode>
    <TooltipProvider delayDuration={150}>
      <App />
      <Toaster
        position="top-center"
        theme="dark"
        toastOptions={{
          style: {
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-default)',
            color: 'var(--color-foreground)',
          },
        }}
      />
    </TooltipProvider>
  </StrictMode>,
);

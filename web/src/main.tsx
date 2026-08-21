import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/auth';
import { queryClient } from '@/lib/query';
import { App } from '@/App';
import { captureReturnTo } from '@/lib/returnTo';
import './index.css';

// Runs before first paint so the shell can decide whether to show the
// "Back to VOX" exit on its very first render.
captureReturnTo();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

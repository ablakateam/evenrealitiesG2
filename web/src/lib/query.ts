import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (failureCount, error) => {
        // Don't retry auth failures — the secret is wrong, retrying won't help.
        if (error instanceof ApiError && (error.status === 401 || error.status === 400)) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});

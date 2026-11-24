import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/lib/auth'
import App from './App'
import './index.css'
import { isEn, startEnglish } from '@/lib/i18n'
import { reloadOnce } from '@/components/PageErrorBoundary'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
})

if (isEn) void startEnglish()

// After a new version is published, an open page may ask for page files that were replaced: reload once.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  reloadOnce()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <AuthProvider>
          <App />
          <Toaster position="top-center" richColors dir={isEn ? 'ltr' : 'rtl'} toastOptions={{ style: { fontFamily: 'Cairo' } }} />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

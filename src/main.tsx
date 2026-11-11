import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AuthProvider } from './features/auth/AuthProvider.tsx'
import AuthRouter from './features/auth/AuthRouter.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AuthRouter />
    </AuthProvider>
  </StrictMode>,
)

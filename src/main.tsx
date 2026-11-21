import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registrarServiceWorker } from './lib/push'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service worker: PWA instalable con caché sin conexión (producción) y avisos push (siempre)
window.addEventListener('load', () => void registrarServiceWorker())

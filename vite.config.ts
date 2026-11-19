import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // El worker de IA usa módulos ES (Transformers.js)
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  // Modo base de datos (npm run dev:bd): la API corre en el servidor Node
  server: { proxy: { '/api': process.env.API_PROXY ?? 'http://localhost:3001' } },
})

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Project Pages URL: https://weatherin2d.github.io/Skywatch-Australia/
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  plugins: [react()],
  base,
  server: {
    host: '127.0.0.1',
    port: 43147,
  },
  preview: {
    host: '127.0.0.1',
    port: 43147,
  },
})

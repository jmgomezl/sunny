import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Local dev: run the bot with BOT_POLLING=off to serve the chat API on :8820.
  server: { proxy: { '/api': 'http://127.0.0.1:8820' } },
})

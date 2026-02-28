import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/three/examples/jsm/')) return 'vendor-three-examples'
          if (id.includes('/three/')) return 'vendor-three-core'
          if (id.includes('/react-dom/')) return 'vendor-react-dom'
          if (id.includes('/react/')) return 'vendor-react'
          if (id.includes('/gsap/')) return 'vendor-gsap'
          return 'vendor-misc'
        },
      },
    },
  },
})

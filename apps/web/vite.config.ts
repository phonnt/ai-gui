import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // One 955 kB main chunk (283 kB gzip) delays first paint on desktop cold start.
        // Split the stable, large vendors so app code stays small and cacheable.
        manualChunks(id) {
          // Bun nests packages as `node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>/…`,
          // so the owning package is the *last* node_modules segment.
          const segments = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/g);
          const pkg = segments?.at(-1)?.slice('node_modules/'.length);
          if (!pkg) return;
          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'vendor-react';
          if (pkg.startsWith('react-router')) return 'vendor-react';
          if (pkg.startsWith('@tanstack')) return 'vendor-query';
          if (pkg.startsWith('@radix-ui') || pkg.startsWith('class-variance-authority')) {
            return 'vendor-ui';
          }
          if (pkg === 'zustand' || pkg === 'clsx' || pkg === 'tailwind-merge') return 'vendor-ui';
          if (pkg === 'lucide-react') return 'vendor-icons';
          if (pkg === 'react-markdown' || pkg.startsWith('remark') || pkg.startsWith('micromark')) {
            return 'vendor-markdown';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.GROVE_PORT ?? 8787}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { writeFileSync, mkdirSync } from 'fs';

const APP_VERSION = new Date()
  .toISOString()
  .replace('T', '-')
  .replace(/:/g, '')
  .slice(0, 16);

function writeVersionPlugin() {
  return {
    name: 'write-version',
    buildStart() {
      mkdirSync('public', { recursive: true });
      writeFileSync('public/version.json', JSON.stringify({ version: APP_VERSION }, null, 2));
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [react(), tailwindcss(), writeVersionPlugin()],
});
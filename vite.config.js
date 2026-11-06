import { defineConfig } from 'vite';
export default defineConfig(({mode})=>({publicDir:mode==='vercel'?false:'public',build:{chunkSizeWarningLimit:1500},server:{host:'127.0.0.1'}}));

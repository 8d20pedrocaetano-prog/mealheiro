// GitHub Pages SPA fallback: unknown paths serve 404.html, which is the app itself (ARCHITECTURE §6).
import { copyFileSync } from 'node:fs';
copyFileSync('dist/index.html', 'dist/404.html');
console.log('dist/404.html written');

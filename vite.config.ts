/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only ride telemetry beacon: the app POSTs one JSON line per second to
// /__telemetry and it lands in .telemetry.log so a coach/agent can tail the
// live ride without touching the browser. Never part of the production build.
export function telemetryBeacon(): Plugin {
  const logPath = path.resolve(__dirname, '.telemetry.log');
  return {
    name: 'telemetry-beacon',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__telemetry', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        if (req.headers['content-type']?.split(';')[0] !== 'application/json' ||
            (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) ||
            (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])))) {
          res.statusCode = 403;
          res.end();
          return;
        }
        let body = '';
        let bytes = 0;
        req.on('data', (chunk) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 4096) {
            body = '';
            if (!res.writableEnded) {
              res.statusCode = 413;
              res.end();
            }
            return;
          }
          body += chunk;
        });
        req.on('end', () => {
          if (res.writableEnded) return;
          try {
            const telemetry = JSON.parse(body);
            fs.appendFile(logPath, JSON.stringify(telemetry) + '\n', () => {});
          } catch { res.statusCode = 400; }
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  test: { include: ['tests/**/*.test.{ts,tsx}'] },
  plugins: [react(), ...(process.env.VITE_RIDE_TELEMETRY === '1' ? [telemetryBeacon()] : [])],
  // Map3D and ScenicRide are intentionally lazy-loaded 3D views. Their vendor-heavy
  // chunks stay off the home-screen path, so use a limit that reflects those routes.
  build: {
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    host: '127.0.0.1'
  }
});

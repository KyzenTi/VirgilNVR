import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { config, ensureRuntimeDirectories } from './server/config.ts';
import { recoverInterruptedRecordings } from './server/db.ts';
import { stopAllCaptures } from './server/ffmpegManager.ts';
import { createApiRouter } from './server/routes.ts';
import { startBackgroundWorkers, stopBackgroundWorkers } from './server/scheduler.ts';

async function bootstrapServer() {
  ensureRuntimeDirectories();
  recoverInterruptedRecordings();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', createApiRouter());

  if (!config.isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build de produção não encontrado. Execute npm run build.');
      }
    });
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[VigilLocal NVR] Servidor ativo na porta ${config.port} (Storage: ${config.storageRoot})`);
    startBackgroundWorkers();
  });

  const shutdown = (signal: string) => {
    console.log(`[VigilLocal NVR] Recebido ${signal}. Encerrando workers e capturas ativas...`);
    stopBackgroundWorkers();
    stopAllCaptures();
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrapServer().catch((err) => {
  console.error('[VigilLocal NVR] Falha fatal na inicialização:', err);
  process.exit(1);
});

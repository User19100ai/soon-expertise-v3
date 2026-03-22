// agent/src/server.ts — Express localhost:9721
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { logger } from './logger';
import { router } from './routes';

export function startServer() {
  const app = express();

  // CORS strict : uniquement l'extension Chrome
  app.use(cors({
    origin: (origin, callback) => {
      // Autoriser les requêtes sans origin (curl, tests) + extensions Chrome
      if (!origin || origin.startsWith('chrome-extension://')) {
        callback(null, true);
      } else {
        callback(new Error('CORS blocked'));
      }
    },
    credentials: true,
  }));

  app.use(express.json({ limit: '1mb' }));

  // Auth middleware — token Bearer
  app.use((req, res, next) => {
    // Health check sans auth
    if (req.path === '/health' && req.method === 'GET') return next();

    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${config.authToken}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });

  // Routes
  app.use('/', router);

  // Error handler
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error', { error: err.message, path: req.path });
    res.status(500).json({ error: 'Internal server error' });
  });

  app.listen(config.port, '127.0.0.1', () => {
    logger.info(`Server started on http://127.0.0.1:${config.port}`);
    logger.info(`Machine: ${config.machineId}`);
    logger.info(`Inbox: ${config.inboxPath}`);
    logger.info(`Missions: ${config.missionsPath}`);
  });
}

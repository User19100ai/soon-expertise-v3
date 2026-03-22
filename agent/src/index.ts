// agent/src/index.ts — Point d'entrée Soon Expertise Agent v3.0
import { config } from './config';
import { logger } from './logger';
import { startWatcher } from './watcher';
import { startServer } from './server';
import fs from 'fs';

async function main() {
  logger.info('═══════════════════════════════════════');
  logger.info('  Soon Expertise Agent v3.0');
  logger.info(`  Machine: ${config.machineId}`);
  logger.info('═══════════════════════════════════════');

  // Vérifier les dossiers
  for (const dir of [config.inboxPath, config.missionsPath, config.archivePath]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info(`Created directory: ${dir}`);
    }
  }

  // Vérifier les clés API
  if (!config.claudeApiKey && !config.mistralApiKey) {
    logger.warn('Aucune clé API configurée dans .env — extraction IA indisponible');
  } else {
    if (config.claudeApiKey) logger.info('Claude API key: configured');
    if (config.mistralApiKey) logger.info('Mistral API key: configured');
  }

  // Démarrer le watcher
  startWatcher();

  // Démarrer le serveur HTTP
  startServer();
}

// Gestion propre de l'arrêt
process.on('SIGINT', () => {
  logger.info('Agent shutting down (SIGINT)');
  process.exit(0);
});
process.on('SIGTERM', () => {
  logger.info('Agent shutting down (SIGTERM)');
  process.exit(0);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
});

main().catch((err) => {
  logger.error('Fatal error', { error: err.message });
  process.exit(1);
});

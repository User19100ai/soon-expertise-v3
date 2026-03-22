// agent/src/config.ts
import dotenv from 'dotenv';
import path from 'path';

// Chercher le .env en remontant depuis le fichier actuel
import fs from 'fs';
function findEnv(): string | undefined {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
const envPath = findEnv();
if (envPath) dotenv.config({ path: envPath });

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

const onedriveBase = required('ONEDRIVE_BASE');

export const config = {
  machineId: required('MACHINE_ID'),
  claudeApiKey: process.env.CLAUDE_API_KEY || '',
  mistralApiKey: process.env.MISTRAL_API_KEY || '',
  inboxPath: path.join(onedriveBase, 'Missions'),
  missionsPath: path.join(onedriveBase, 'Missions', '.data'),
  archivePath: path.join(onedriveBase, 'Missions', '.data', '_archive'),
  port: parseInt(process.env.PORT || '9721', 10),
  authToken: required('AUTH_TOKEN'),
  localDbPath: path.join(
    process.env.HOME || '/tmp',
    '.soon-expertise',
    'cache.db'
  ),
  logPath: path.join(
    process.env.HOME || '/tmp',
    '.soon-expertise',
    'agent.log'
  ),
};

// agent/src/logger.ts
import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { config } from './config';

const logDir = path.dirname(config.logPath);
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { machine: config.machineId },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, mission_id, ...rest }) => {
          const mid = mission_id ? ` [${mission_id}]` : '';
          const extra = Object.keys(rest).length > 1 ? ' ' + JSON.stringify(rest) : '';
          return `${timestamp} ${level}${mid}: ${message}${extra}`;
        })
      )
    }),
    new winston.transports.File({ filename: config.logPath, maxsize: 5_000_000, maxFiles: 3 })
  ]
});

// agent/src/hasher.ts
import crypto from 'crypto';
import fs from 'fs';

export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export function generateId(): string {
  return crypto.randomBytes(6).toString('hex'); // 12 chars
}

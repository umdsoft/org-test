import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export function loadEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    if (!line || line.trim().startsWith('#')) {
      return;
    }
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      return;
    }
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (!key) {
      return;
    }
    const unquoted = value.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    if (process.env[key] === undefined) {
      process.env[key] = unquoted;
    }
  });
}

import fs from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';

export interface MemoryConfig {
  /** URL where the app runs, e.g. http://localhost:3000 */
  baseUrl: string;
  /** Optional command to start the app when it is not already running. */
  startCommand?: string;
  /** Only fetch/XHR requests whose path starts with this are saved. '' = all. */
  apiPrefix: string;
  /** Test account used when the feature needs login. */
  auth: { username: string; password: string };
  /** JSON keys whose values are replaced with *** in saved requests/responses. */
  mask: string[];
  /** Where feature docs are written. */
  outputDir: string;
  /** Delay in ms before every browser action, so the run and video are easy to follow. 0 = full speed. */
  slowMo: number;
}

export const DEFAULT_MASK = ['password', 'token', 'secret', 'authorization', 'cookie', 'phone', 'email'];

const CONFIG_FILES = [
  'project-memory.config.ts',
  'project-memory.config.mts',
  'project-memory.config.js',
  'project-memory.config.mjs',
];

export function findConfig(root: string): string | null {
  for (const file of CONFIG_FILES) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function loadEnvFiles(root: string): void {
  // .env.local first: loadEnvFile never overwrites a variable that is already set.
  for (const file of ['.env.local', '.env']) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    try {
      process.loadEnvFile(full);
    } catch {
      // ignore malformed env files
    }
  }
}

export async function loadConfig(root: string): Promise<MemoryConfig | null> {
  loadEnvFiles(root);
  const file = findConfig(root);
  if (!file) return null;

  const jiti = createJiti(import.meta.url);
  const user = (await jiti.import(file, { default: true })) as Partial<MemoryConfig>;

  return {
    baseUrl: 'http://localhost:3000',
    apiPrefix: '/api',
    outputDir: 'docs/memory',
    mask: DEFAULT_MASK,
    slowMo: 500,
    ...user,
    auth: { username: '', password: '', ...(user.auth ?? {}) },
  };
}

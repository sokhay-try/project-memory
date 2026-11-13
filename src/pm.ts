import fs from 'node:fs';
import path from 'node:path';

export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];

/** Which package manager the project uses, from its lockfile (falls back to npm). */
export function detectPm(root: string): PackageManager {
  for (const [file, pm] of LOCKFILES) if (fs.existsSync(path.join(root, file))) return pm;
  const ua = process.env.npm_config_user_agent ?? '';
  for (const pm of ['pnpm', 'yarn', 'bun'] as const) if (ua.startsWith(pm)) return pm;
  return 'npm';
}

/** Command that runs a package.json script, e.g. `npm run memory-feature -- src/x.vue`. */
export function runScript(pm: PackageManager, script: string, args = ''): string {
  const tail = args ? ` ${args}` : '';
  if (pm === 'npm') return `npm run ${script}${args ? ` --${tail}` : ''}`;
  if (pm === 'bun') return `bun run ${script}${tail}`;
  return `${pm} ${script}${tail}`;
}

/** Command that runs a bin from node_modules, e.g. `npx playwright …`. */
export function execBin(pm: PackageManager, bin: string): string {
  return { pnpm: `pnpm exec ${bin}`, yarn: `yarn ${bin}`, bun: `bunx ${bin}`, npm: `npx ${bin}` }[pm];
}

/** Command that adds dev dependencies. */
export function addDev(pm: PackageManager, pkgs: string): string {
  return { pnpm: `pnpm add -D ${pkgs}`, yarn: `yarn add -D ${pkgs}`, bun: `bun add -d ${pkgs}`, npm: `npm install -D ${pkgs}` }[pm];
}

export function installPlaywright(pm: PackageManager): string {
  return `${addDev(pm, '@playwright/test')} && ${execBin(pm, 'playwright install chromium')}`;
}

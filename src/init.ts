import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findConfig, loadConfig } from './config.js';
import { claudeVersion } from './claude.js';
import { resolvePlaywrightCli } from './playwright.js';
import { memoryFeatureCommand, memoryReadmeCommand } from './prompts.js';
import { log, bold, dim, cyan } from './ui.js';
import { detectPm, runScript, installPlaywright } from './pm.js';

const FIXTURE_TEMPLATE = fileURLToPath(new URL('../templates/fixture.ts', import.meta.url));

const CONFIG_TEMPLATE = `// project-memory config
export default {
  // URL where your app runs
  baseUrl: 'http://localhost:3000',

  // Optional: command to start the app if it is not running yet
  // startCommand: 'pnpm dev',

  // Only fetch/XHR calls whose path starts with this are saved as APIs ('' = all)
  apiPrefix: '/api',

  // Test account used when a feature needs login.
  // Use a staging/test account — never real production data.
  auth: {
    username: process.env.MEMORY_USER ?? '',
    password: process.env.MEMORY_PASS ?? '',
  },

  // JSON keys whose values are hidden (***) in saved requests/responses
  mask: ['password', 'token', 'secret', 'authorization', 'cookie', 'phone', 'email'],

  // Where feature docs are written
  outputDir: 'docs/memory',

  // Wait this many ms before each browser action, so the run and video are easy to follow (0 = full speed)
  slowMo: 500,
};
`;

const MARKER = 'project-memory';

/** Copy the recording fixture into <outputDir>/fixture.ts (always refreshed). */
export function writeFixture(outRoot: string): string {
  fs.mkdirSync(outRoot, { recursive: true });
  const file = path.join(outRoot, 'fixture.ts');
  fs.copyFileSync(FIXTURE_TEMPLATE, file);
  return file;
}

function writeOwnedFile(file: string, content: string, root: string): void {
  const rel = path.relative(root, file);
  if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(MARKER)) {
    log.warn(`${rel} exists and was not created by project-memory — left unchanged`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  log.ok(`Wrote ${rel}`);
}

function addToGitignore(root: string, entry: string): void {
  const file = path.join(root, '.gitignore');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.split('\n').some((l) => l.trim() === entry)) return;
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(file, `${current}${prefix}\n# project-memory (temporary run files)\n${entry}\n`);
  log.ok(`Added ${entry} to .gitignore`);
}

const SCRIPTS: Record<string, string> = {
  'memory-feature': 'project-memory',
  'memory-docs': 'project-memory docs',
};

function addScripts(root: string): void {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) {
    const list = Object.entries(SCRIPTS).map(([k, v]) => `"${k}": "${v}"`).join(', ');
    log.warn(`No package.json found — add the scripts yourself: ${list}`);
    return;
  }
  const raw = fs.readFileSync(file, 'utf8');
  const pkg = JSON.parse(raw);
  pkg.scripts ??= {};
  const added = Object.keys(SCRIPTS).filter((k) => !pkg.scripts[k]);
  if (!added.length) return;
  for (const k of added) pkg.scripts[k] = SCRIPTS[k];
  const indent = raw.match(/^[ \t]+/m)?.[0] ?? '  ';
  fs.writeFileSync(file, JSON.stringify(pkg, null, indent) + (raw.endsWith('\n') ? '\n' : ''));
  log.ok(`Added ${added.map((k) => `"${k}"`).join(', ')} to package.json scripts`);
}

export async function init(root: string): Promise<void> {
  log.title('Project Memory · setup');
  const pm = detectPm(root);

  const existing = findConfig(root);
  if (existing) {
    log.ok(`Config found: ${path.relative(root, existing)}`);
  } else {
    fs.writeFileSync(path.join(root, 'project-memory.config.ts'), CONFIG_TEMPLATE);
    log.ok('Wrote project-memory.config.ts');
  }

  const config = await loadConfig(root);
  const outRoot = path.resolve(root, config?.outputDir ?? 'docs/memory');
  writeFixture(outRoot);
  log.ok(`Wrote ${path.relative(root, path.join(outRoot, 'fixture.ts'))}`);

  // `project-memory` appears in both command texts, so they count as ours on re-init.
  writeOwnedFile(
    path.join(root, '.claude/commands/memory-feature.md'),
    memoryFeatureCommand(runScript(pm, 'memory-feature', '$ARGUMENTS')),
    root,
  );
  writeOwnedFile(path.join(root, '.claude/commands/memory-readme.md'), memoryReadmeCommand(), root);

  addToGitignore(root, '.project-memory/');
  addScripts(root);

  log.title('Checks');
  const claude = claudeVersion();
  if (claude) log.ok(`Claude Code ${dim(claude)}`);
  else log.warn('Claude Code not found — install it and log in: https://claude.com/claude-code');

  if (resolvePlaywrightCli(root)) log.ok('Playwright installed');
  else log.warn(`Playwright not installed — run: ${cyan(installPlaywright(pm))}`);

  log.title('Next');
  log.plain(`  1. Check ${bold('project-memory.config.ts')} (baseUrl, apiPrefix, test account)`);
  log.plain(`  2. Start your app, then run: ${cyan(runScript(pm, 'memory-feature', '<page file or folder>'))}`);
  log.plain(`  3. Browse the docs: ${cyan(runScript(pm, 'memory-docs'))}`);
  log.plain('');
}

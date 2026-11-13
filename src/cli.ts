#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { init } from './init.js';
import { runFeature } from './run.js';
import { serveDocs } from './docs.js';
import { log } from './ui.js';

const HELP = `
project-memory — document a frontend feature with Claude Code + Playwright

Usage
  project-memory init                  Set up this project (config, slash commands, script)
  project-memory <path> [options]      Scan → run → save docs for one feature
  project-memory docs [feature]        Open the saved docs in your browser

  In a project with the scripts added: pnpm memory-feature app/attendance/page.tsx
                                       pnpm memory-docs [feature]

Options
  --name <name>     Feature name (default: from the path, e.g. "attendance")
  --regenerate      Ask Claude to rewrite the test even if one is saved
  --no-ui           Run automatically without the Playwright window (headless)
  --headed          With --no-ui: show the browser while it runs
  --slow-mo <ms>    Wait this long before each browser action (default: slowMo in config, 500; 0 = full speed)
  -y, --yes         Answer yes to every question
  -h, --help        Show this help

Docs options
  --port <port>     First port to try (default 4400)
  --no-open         Start the server without opening the browser
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      regenerate: { type: 'boolean' },
      'no-ui': { type: 'boolean' },
      headed: { type: 'boolean' },
      'slow-mo': { type: 'string' },
      port: { type: 'string' },
      'no-open': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const root = process.cwd();
  const [first] = positionals;

  if (values.help || !first) {
    console.log(HELP);
    return;
  }
  if (first === 'init') {
    await init(root);
    return;
  }
  if (first === 'docs') {
    const port = values.port === undefined ? undefined : Number(values.port);
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new Error(`--port must be a port number, got "${values.port}"`);
    }
    await serveDocs(root, { feature: positionals[1], port, open: !values['no-open'] });
    return;
  }

  let slowMo: number | undefined;
  if (values['slow-mo'] !== undefined) {
    slowMo = Number(values['slow-mo']);
    if (!Number.isFinite(slowMo) || slowMo < 0) throw new Error(`--slow-mo must be a number of ms ≥ 0, got "${values['slow-mo']}"`);
  }

  await runFeature(root, first, {
    slowMo,
    name: values.name,
    regenerate: values.regenerate,
    yes: values.yes,
    mode: values['no-ui'] ? (values.headed ? 'headed' : 'headless') : 'ui',
  });
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { featureNameFromPath } from './feature.js';
import { claudeVersion, runClaude } from './claude.js';
import { scanPrompt, readmePrompt } from './prompts.js';
import { resolvePlaywrightCli, writePlaywrightConfig, runPlaywright, isReachable, type RunMode } from './playwright.js';
import { readRun, writeFlow, writeApi, writeFeatureJson } from './report.js';
import { writeFixture } from './init.js';
import { serveDocs } from './docs.js';
import { detectPm, runScript, execBin, installPlaywright } from './pm.js';
import { log, confirm, box, bold, dim, cyan, green, red } from './ui.js';

export interface RunOptions {
  name?: string;
  regenerate?: boolean;
  yes?: boolean;
  mode: RunMode;
  /** Overrides config.slowMo for this run. */
  slowMo?: number;
}

const posix = (p: string) => p.split(path.sep).join('/');

function fail(message: string, hint?: string): never {
  log.error(message);
  if (hint) log.plain(`  ${hint}`);
  process.exit(1);
}

export async function runFeature(root: string, target: string, opts: RunOptions): Promise<void> {
  // ── Setup ────────────────────────────────────────────────────────────────
  const config = await loadConfig(root);
  const pm = detectPm(root);
  if (!config) fail('No project-memory.config.ts found.', `Run ${cyan(execBin(pm, 'project-memory init'))} first.`);
  if (opts.slowMo !== undefined) config.slowMo = opts.slowMo;

  const entryAbs = path.resolve(root, target);
  if (!fs.existsSync(entryAbs)) fail(`Not found: ${target}`);
  const entry = posix(path.relative(root, entryAbs));
  const isDir = fs.statSync(entryAbs).isDirectory();

  const name = opts.name ?? featureNameFromPath(entry, isDir);
  const outRoot = path.resolve(root, config.outputDir);
  const dir = path.join(outRoot, name);
  const specFile = path.join(dir, `${name}.spec.ts`);
  const rel = (p: string) => posix(path.relative(root, p));

  log.title(`Project Memory · ${name}`);
  log.plain(dim(`  entry  ${entry}`));
  log.plain(dim(`  docs   ${rel(dir)}/`));

  fs.mkdirSync(dir, { recursive: true });
  writeFixture(outRoot);

  // ── 1. Test: reuse, or ask Claude to write it ─────────────────────────────
  log.title('1. Test');
  if (fs.existsSync(specFile) && !opts.regenerate) {
    log.ok(`Using saved test ${rel(specFile)} ${dim('(--regenerate to rewrite it)')}`);
  } else {
    const version = claudeVersion();
    if (!version) fail('Claude Code is not installed.', 'Install it and log in: https://claude.com/claude-code');

    const yes = opts.yes || (await confirm(`Ask Claude to scan "${name}" and write the test now?`));
    if (!yes) {
      log.plain('');
      log.plain(`  Open Claude Code in VS Code and type:`);
      log.plain(`    ${cyan(`/memory-feature ${entry}`)}`);
      log.plain(`  When the test is written, run this command again.`);
      log.plain('');
      return;
    }

    log.info(`Claude is reading ${entry} …`);
    const result = await runClaude(scanPrompt({ name, entry, specPath: rel(specFile) }), root);
    if (!result.ok) {
      fail(
        `Claude could not finish: ${result.text.split('\n')[0]}`,
        `If you are not logged in, run ${cyan('claude')} once in a terminal and log in.`,
      );
    }
    if (!fs.existsSync(specFile)) fail(`Claude finished but did not write ${rel(specFile)}.`);
    log.ok(`Wrote ${rel(specFile)}`);
    box(result.text);
  }

  // ── 2. Run with Playwright ───────────────────────────────────────────────
  log.title('2. Run');
  const cli = resolvePlaywrightCli(root);
  if (!cli) {
    fail(
      'Playwright is not installed in this project.',
      `Run ${cyan(installPlaywright(pm))}`,
    );
  }

  if (!config.startCommand && !(await isReachable(config.baseUrl))) {
    fail(
      `Your app is not running at ${config.baseUrl}.`,
      `Start it (e.g. ${cyan(runScript(pm, 'dev'))}), or set startCommand in project-memory.config.ts.`,
    );
  }

  const workDir = path.join(root, '.project-memory');
  const runFile = path.join(workDir, 'runs', `${name}.json`);
  const videoDir = path.join(workDir, 'videos', name);
  fs.rmSync(runFile, { force: true });
  fs.rmSync(videoDir, { recursive: true, force: true });

  const configFile = writePlaywrightConfig({ workDir, featureDir: dir, specFile, config });

  if (opts.mode === 'ui') {
    log.info(`Opening Playwright… click ${bold('▶ Run')}, then ${bold('close the window')} when you are done.`);
  } else {
    log.info('Running the test…');
  }

  await runPlaywright(
    cli,
    configFile,
    opts.mode,
    {
      PM_RUN_FILE: runFile,
      PM_VIDEO_DIR: videoDir,
      PM_API_PREFIX: config.apiPrefix,
      PM_MASK: config.mask.join(','),
      PM_USERNAME: config.auth.username,
      PM_PASSWORD: config.auth.password,
    },
    root,
  );

  // ── 3. Save docs ─────────────────────────────────────────────────────────
  log.title('3. Save');
  const run = readRun(runFile);
  if (!run) {
    log.warn('No run was recorded — nothing saved.');
    if (opts.mode === 'ui') log.plain(`  Click ${bold('▶ Run')} in Playwright before closing the window.`);
    else log.plain(`  Check the Playwright output above (e.g. a missing browser: ${execBin(pm, 'playwright install chromium')}).`);
    return;
  }

  let hasVideo = false;
  if (run.video && fs.existsSync(run.video)) {
    fs.copyFileSync(run.video, path.join(dir, 'video.webm'));
    hasVideo = true;
  }

  const docs = { dir, name, entry, specFile, run };
  const saved = [writeFlow(docs, hasVideo), writeApi(docs), writeFeatureJson(docs)];
  if (hasVideo) saved.push(path.join(dir, 'video.webm'));

  const passed = run.status === 'passed';
  const result = passed ? green('passed') : red(run.status);
  log.ok(`Test ${result} · ${run.steps.length} steps · ${run.apis.length} API calls`);
  for (const f of saved) log.plain(dim(`    ${rel(f)}`));
  if (!passed) {
    log.warn(`Some steps failed — see ${rel(path.join(dir, 'flow.md'))}.`);
    log.plain(`  Fix ${rel(specFile)} yourself, or run again with ${cyan('--regenerate')}.`);
  }

  // ── 4. README ────────────────────────────────────────────────────────────
  log.title('4. README');
  // After a failed run the docs are incomplete, so default to "no".
  const readmeYes =
    claudeVersion() !== null &&
    (opts.yes || (await confirm('Ask Claude to write README.md for this feature?', passed)));
  if (!readmeYes) {
    log.plain(`  Later, in Claude Code type: ${cyan(`/memory-readme ${name}`)}`);
  } else {
    log.info('Claude is writing README.md …');
    const res = await runClaude(readmePrompt({ name, entry, dir: rel(dir) }), root);
    if (res.ok && fs.existsSync(path.join(dir, 'README.md'))) log.ok(`Wrote ${rel(path.join(dir, 'README.md'))}`);
    else log.warn(`README not written: ${res.text.split('\n')[0]}`);
  }

  log.plain('');
  log.ok(`Done → ${bold(rel(dir) + '/')}`);
  log.plain('');

  // ── Open the docs ────────────────────────────────────────────────────────
  // Not covered by --yes: the docs server keeps running until Ctrl+C, which would block scripts/CI.
  if (process.stdin.isTTY && (await confirm('Open the docs in your browser?'))) {
    await serveDocs(root, { feature: name });
  } else {
    log.plain(`  Open them any time: ${cyan(runScript(pm, 'memory-docs', name))}`);
    log.plain('');
  }
}

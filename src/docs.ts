import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { marked } from 'marked';
import { loadConfig } from './config.js';
import { toTitle } from './feature.js';
import { log, bold, dim, cyan } from './ui.js';
import { detectPm, runScript } from './pm.js';

export interface DocsOptions {
  /** Open this feature instead of the list of all features. */
  feature?: string;
  /** First port to try (default 4400). */
  port?: number;
  /** Open the browser (default true). */
  open?: boolean;
}

interface FeatureJson {
  name?: string;
  entry?: string;
  test?: string;
  lastRun?: { at: string; status: string; durationMs: number; steps: number; apis: number };
}

interface Feature {
  name: string;
  dir: string;
  info: FeatureJson;
}

const TABS = [
  { id: 'README.md', label: 'Overview' },
  { id: 'flow.md', label: 'Flow' },
  { id: 'api.md', label: 'APIs' },
  { id: 'video', label: 'Video' },
  { id: 'test', label: 'Test' },
] as const;

const MIME: Record<string, string> = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Reading the docs folder ────────────────────────────────────────────────

function readJson(file: string): FeatureJson {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as FeatureJson;
  } catch {
    return {};
  }
}

function listFeatures(outRoot: string): Feature[] {
  if (!fs.existsSync(outRoot)) return [];
  return fs
    .readdirSync(outRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, dir: path.join(outRoot, d.name), info: readJson(path.join(outRoot, d.name, 'feature.json')) }))
    .filter((f) => fs.existsSync(path.join(f.dir, 'feature.json')) || fs.existsSync(path.join(f.dir, 'flow.md')))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function specFileOf(f: Feature): string | null {
  if (f.info.test && fs.existsSync(path.join(f.dir, f.info.test))) return f.info.test;
  return fs.readdirSync(f.dir).find((n) => /\.spec\.[cm]?[jt]sx?$/.test(n)) ?? null;
}

function hasTab(f: Feature, tab: string): boolean {
  if (tab === 'video') return fs.existsSync(path.join(f.dir, 'video.webm'));
  if (tab === 'test') return specFileOf(f) !== null;
  return fs.existsSync(path.join(f.dir, tab));
}

// ── HTML ──────────────────────────────────────────────────────────────────

const STYLE = `
:root {
  --bg: #ffffff; --bg-soft: #f6f7f9; --text: #1d2129; --muted: #626a75; --border: #e3e6ea;
  --accent: #2f6fde; --accent-soft: #e8f0fd; --code-bg: #f3f4f6;
  --ok: #18794e; --ok-soft: #e6f6ee; --bad: #c4321c; --bad-soft: #fdecea;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15171b; --bg-soft: #1c1f24; --text: #e6e8eb; --muted: #9aa3ae; --border: #2c3036;
    --accent: #7aa8ff; --accent-soft: #1e2a40; --code-bg: #1f2329;
    --ok: #5fd19b; --ok-soft: #173126; --bad: #ff8a78; --bad-soft: #3a1d19;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.top { border-bottom: 1px solid var(--border); background: var(--bg-soft); }
.top .in { max-width: 960px; margin: 0 auto; padding: 12px 20px; display: flex; gap: 8px; align-items: center; font-size: 14px; }
.top a.brand { color: var(--text); font-weight: 600; }
.top .sep { color: var(--muted); }
main { max-width: 960px; margin: 0 auto; padding: 24px 20px 64px; }
h1.page { margin: 0 0 4px; font-size: 26px; }
.meta { color: var(--muted); font-size: 13px; display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
.meta code { font-size: 12px; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.badge.ok { color: var(--ok); background: var(--ok-soft); }
.badge.bad { color: var(--bad); background: var(--bad-soft); }
nav.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin: 20px 0 24px; overflow-x: auto; }
nav.tabs a { padding: 8px 14px; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap; }
nav.tabs a:hover { color: var(--text); text-decoration: none; }
nav.tabs a.on { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }
.md h1 { font-size: 24px; margin-top: 0; }
.md > h1:first-child { display: none; } /* repeats the page title above the tabs */
.md h2 { font-size: 19px; margin-top: 32px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }
.md h3 { font-size: 16px; margin-top: 24px; }
.md blockquote { margin: 0 0 16px; padding: 8px 14px; color: var(--muted); background: var(--bg-soft); border-left: 3px solid var(--border); border-radius: 4px; }
.md blockquote p { margin: 0; }
.md hr { border: 0; border-top: 1px solid var(--border); margin: 28px 0; }
code { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--code-bg); padding: 1px 5px; border-radius: 4px; }
pre { background: var(--code-bg); padding: 14px 16px; border-radius: 8px; overflow: auto; }
pre code { padding: 0; background: none; }
table { border-collapse: collapse; width: 100%; margin: 12px 0 20px; font-size: 14px; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: var(--bg-soft); }
video { width: 100%; border-radius: 8px; border: 1px solid var(--border); background: #000; }
.empty { color: var(--muted); padding: 32px; text-align: center; border: 1px dashed var(--border); border-radius: 8px; }
.cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); margin-top: 20px; }
.card { display: block; padding: 16px; border: 1px solid var(--border); border-radius: 10px; color: var(--text); background: var(--bg); }
.card:hover { border-color: var(--accent); text-decoration: none; }
.card h2 { margin: 0 0 6px; font-size: 17px; }
.card .meta { margin-top: 8px; }
.hint { color: var(--muted); font-size: 13px; }
`;

function layout(title: string, crumbs: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style></head>
<body>
<div class="top"><div class="in"><a class="brand" href="/">Project Memory</a>${crumbs}</div></div>
<main>${body}</main>
</body></html>`;
}

function statusBadge(status?: string): string {
  if (!status) return '';
  return `<span class="badge ${status === 'passed' ? 'ok' : 'bad'}">${esc(status)}</span>`;
}

function runMeta(info: FeatureJson): string {
  const r = info.lastRun;
  const parts: string[] = [];
  if (r) {
    parts.push(statusBadge(r.status));
    parts.push(`<span>${r.steps} steps · ${r.apis} API calls · ${(r.durationMs / 1000).toFixed(1)}s</span>`);
    parts.push(`<span>Last run ${esc(new Date(r.at).toLocaleString())}</span>`);
  }
  if (info.entry) parts.push(`<code>${esc(info.entry)}</code>`);
  return `<div class="meta">${parts.join('')}</div>`;
}

function indexPage(features: Feature[], outRel: string, runCommand: string): string {
  const body = features.length
    ? `<div class="cards">${features
        .map(
          (f) => `<a class="card" href="/${encodeURIComponent(f.name)}/">
  <h2>${esc(toTitle(f.name))}</h2>${runMeta(f.info)}</a>`,
        )
        .join('')}</div>`
    : `<div class="empty">No feature docs yet in <code>${esc(outRel)}/</code>.<br>Run <code>${esc(runCommand)}</code> first.</div>`;
  return layout(
    'Project Memory',
    '',
    `<h1 class="page">Features</h1><p class="hint">${features.length} documented · <code>${esc(outRel)}/</code></p>${body}`,
  );
}

function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false, gfm: true }) as string;
  // Markdown links to the raw video open the player tab instead.
  return html.replace(/href="(?:\.\/)?video\.webm"/g, 'href="video"');
}

function featurePage(f: Feature, tab: string, content: string): string {
  const tabs = TABS.filter((t) => hasTab(f, t.id))
    .map((t) => `<a href="${t.id}" class="${t.id === tab ? 'on' : ''}">${t.label}</a>`)
    .join('');
  const title = toTitle(f.name);
  return layout(
    `${title} · Project Memory`,
    `<span class="sep">/</span><span>${esc(title)}</span>`,
    `<h1 class="page">${esc(title)}</h1>${runMeta(f.info)}<nav class="tabs">${tabs}</nav>${content}`,
  );
}

function tabContent(f: Feature, tab: string): string | null {
  if (tab === 'video') {
    if (!hasTab(f, 'video')) return null;
    return `<video src="video.webm" controls autoplay muted playsinline></video>
<p class="hint">Recorded by Playwright during the last run. Use the ⋮ menu to change speed or download.</p>`;
  }
  if (tab === 'test') {
    const spec = specFileOf(f);
    if (!spec) return null;
    const code = fs.readFileSync(path.join(f.dir, spec), 'utf8');
    return `<p class="hint"><code>${esc(spec)}</code> · edit it like any Playwright test, keep the <code>step('…')</code> wrappers.</p><pre><code>${esc(code)}</code></pre>`;
  }
  const file = path.join(f.dir, tab);
  if (!fs.existsSync(file)) return null;
  return `<article class="md">${renderMarkdown(fs.readFileSync(file, 'utf8'))}</article>`;
}

// ── Server ────────────────────────────────────────────────────────────────

function send(res: http.ServerResponse, status: number, body: string, type = 'text/html; charset=utf-8'): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function redirect(res: http.ServerResponse, to: string): void {
  res.writeHead(302, { Location: to });
  res.end();
}

/** Serve a file with Range support, so the video can be seeked. */
function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string): void {
  const size = fs.statSync(file).size;
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && size > 0) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

function handler(outRoot: string, outRel: string, runCommand: string) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      const notFound = () => send(res, 404, layout('Not found', '', `<div class="empty">Not found: <code>${esc(url.pathname)}</code> · <a href="/">All features</a></div>`));

      if (parts.length === 0) return send(res, 200, indexPage(listFeatures(outRoot), outRel, runCommand));

      const feature = listFeatures(outRoot).find((f) => f.name === parts[0]);
      if (!feature) return notFound();
      if (parts.length === 1) {
        if (!url.pathname.endsWith('/')) return redirect(res, `/${encodeURIComponent(feature.name)}/`);
        const first = TABS.find((t) => hasTab(feature, t.id));
        return first ? redirect(res, first.id) : notFound();
      }
      if (parts.length !== 2) return notFound();

      const tab = parts[1];
      if (TABS.some((t) => t.id === tab)) {
        const content = tabContent(feature, tab);
        return content === null ? notFound() : send(res, 200, featurePage(feature, tab, content));
      }
      // Clicking the spec link inside flow.md shows the Test tab.
      if (tab === specFileOf(feature) && req.headers.accept?.includes('text/html')) return redirect(res, 'test');

      // Any other file inside the feature folder (video, images, other .md) — never outside it.
      const file = path.resolve(feature.dir, tab);
      if (path.dirname(file) !== feature.dir || !fs.existsSync(file) || !fs.statSync(file).isFile()) return notFound();
      if (file.endsWith('.md')) {
        return send(res, 200, featurePage(feature, tab, `<article class="md">${renderMarkdown(fs.readFileSync(file, 'utf8'))}</article>`));
      }
      return sendFile(req, res, file);
    } catch (err) {
      send(res, 500, `Error: ${esc(String(err))}`, 'text/plain; charset=utf-8');
    }
  };
}

function listen(server: http.Server, port: number, tries = 20): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      if (err.code === 'EADDRINUSE' && tries > 1) resolve(listen(server, port + 1, tries - 1));
      else reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => log.plain(`  Open ${cyan(url)} in your browser.`));
    child.unref();
  } catch {
    log.plain(`  Open ${cyan(url)} in your browser.`);
  }
}

/** Serve <outputDir> as a small docs site and open it in the browser. Runs until Ctrl+C. */
export async function serveDocs(root: string, opts: DocsOptions = {}): Promise<void> {
  const config = await loadConfig(root);
  const outRoot = path.resolve(root, config?.outputDir ?? 'docs/memory');
  const outRel = path.relative(root, outRoot).split(path.sep).join('/') || '.';

  if (opts.feature && !listFeatures(outRoot).some((f) => f.name === opts.feature)) {
    log.warn(`No docs for "${opts.feature}" in ${outRel}/ — opening the list of features.`);
    opts.feature = undefined;
  }

  const runCommand = runScript(detectPm(root), 'memory-feature', '<path>');
  const server = http.createServer(handler(outRoot, outRel, runCommand));
  const port = await listen(server, opts.port ?? 4400);
  const base = `http://localhost:${port}`;
  const url = opts.feature ? `${base}/${encodeURIComponent(opts.feature)}/` : `${base}/`;

  log.ok(`Docs at ${bold(url)} ${dim('(Ctrl+C to stop)')}`);
  if (opts.open !== false) openBrowser(url);

  await new Promise<void>((resolve) => {
    const stop = () => {
      server.close(() => resolve());
      server.closeAllConnections(); // browsers keep connections open; don't wait for them
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  log.plain(dim('  Docs server stopped.'));
}

# project-memory

Document a frontend feature with one command. Claude Code reads the feature and writes a Playwright test. You click **▶ Run**, and the tool saves the flow, the API calls and a video.

```
pnpm memory-feature app/attendance/page.tsx
```

```
1. Test   Claude reads the page + its imports → writes attendance.spec.ts
          (asks "Ask Claude to scan?" — No = do it yourself with /memory-feature in Claude Code)
2. Run    Playwright UI opens → you click ▶ Run → it records steps, API calls, video
3. Save   docs/memory/attendance/  flow.md · api.md · video.webm · feature.json
4. README Claude writes README.md (or later: /memory-readme attendance)
5. Open   docs open in your browser (or later: pnpm memory-docs attendance)
```

No API key. Claude runs through your own **Claude Code** login.

## Requirements

- Node 20.12+
- [Claude Code](https://claude.com/claude-code), installed and logged in (run `claude` once)
- project-memory built: run `pnpm install` once in this folder, which creates `dist/`
- `@playwright/test` installed in your project (step 1 below)

## Install into a project

The commands below assume project-memory sits next to your project (`../project-memory`). Change the path if it is somewhere else.

### 1. Install Playwright

```bash
# pnpm
pnpm add -D @playwright/test
pnpm exec playwright install chromium

# npm
npm install -D @playwright/test
npx playwright install chromium
```

### 2. Add project-memory and run `init`

**pnpm**

```bash
pnpm add -D link:../project-memory          # or: git+https://github.com/<org>/project-memory.git
pnpm exec project-memory init
```

**npm** has no `link:`. Install it by path:

```bash
npm install -D ../project-memory
npx project-memory init
```

Or keep the tool's path out of `package-lock.json`: add the two scripts to `package.json` yourself, then run `init` from the tool's folder. `init` keeps scripts that already exist.

```json
"memory-feature": "node ../project-memory/dist/cli.js",
"memory-docs": "node ../project-memory/dist/cli.js docs"
```

```bash
node ../project-memory/dist/cli.js init
```

`init` creates:

| File | What it is |
|---|---|
| `project-memory.config.ts` | baseUrl, test account, API prefix, masked keys |
| `docs/memory/fixture.ts` | Records steps, APIs and video while the test runs. Refreshed on every run. |
| `.claude/commands/memory-feature.md` | `/memory-feature <path>` slash command for Claude Code |
| `.claude/commands/memory-readme.md` | `/memory-readme <feature>` slash command |
| `package.json` → `"memory-feature"`, `"memory-docs"` scripts | so you can run `pnpm memory-feature …` and `pnpm memory-docs` |
| `.gitignore` → `.project-memory/` | temporary run files |

### 3. Edit `project-memory.config.ts`

- `baseUrl`: where your dev server runs, e.g. `http://localhost:5173`.
- `apiPrefix`: how your API paths start, e.g. `/api/v1`. Look at a request in the browser's Network tab. Only the path is compared, so it also works when the API is on another host or port.
- `startCommand`: leave it out if you start the dev server yourself.

See [Config](#config) for every option.

### 4. Set the test account

Put it in `.env.local` or `.env` (`.env.local` is read first), and make sure git ignores that file:

```
MEMORY_USER=teacher
MEMORY_PASS=secret123
```

Use a staging or test account, and the password that works on the backend your app talks to. If the app runs against a local backend, that is the local password.

### 5. Check before the first run

- **Unit tests**: Vitest and Jest match `*.spec.ts` everywhere by default, so they would also try to run the Playwright tests in `docs/memory/`. Limit them to your source folder, e.g. Vitest `test.include: ['src/**/*.spec.ts']`, or Jest `testPathIgnorePatterns: ['/docs/memory/']`.
- **Docker**: add `.project-memory` to `.dockerignore`, so the run files (videos, traces) stay out of the build context.
- **Git**: `docs/memory/` is meant to be committed. Add it to `.gitignore` if you would rather keep the recordings on your computer (see [Privacy](#privacy)).
- **Language**: every run starts in a new browser, so the app opens in its default language. If the test looks for text in another language, switch the language as its first step.
- **Real data**: a test that saves something (a sale, a form) creates real records in the backend it runs against.

## Use

Start your app (`pnpm dev`), then:

```bash
pnpm memory-feature app/attendance/page.tsx      # file
pnpm memory-feature src/features/attendance      # or a folder
```

With npm, put `--` before the path and options: `npm run memory-feature -- app/attendance/page.tsx --no-ui`, and `npm run memory-docs -- attendance`.

| Option | |
|---|---|
| `--name <name>` | Feature name (default from the path: `app/attendance/page.tsx` → `attendance`) |
| `--regenerate` | Ask Claude to write a new test, even if one is saved |
| `--no-ui` | Run automatically without the Playwright window (headless) |
| `--headed` | With `--no-ui`, show the browser |
| `--slow-mo <ms>` | Wait this long before each browser action (default `slowMo` from config; `0` = full speed) |
| `-y, --yes` | Answer yes to every question |

The test is saved in `docs/memory/<feature>/`. Later runs reuse it and go straight to Playwright. You can edit it like any Playwright test. Keep the `step('...')` wrappers, because they become the steps in `flow.md`.

## Browse the docs

```bash
pnpm memory-docs              # all features
pnpm memory-docs attendance   # one feature
```

Starts a local server (localhost only, from port 4400) and opens your browser. Each feature has tabs: **Overview** (README), **Flow**, **APIs**, **Video** and **Test**. Pages are read from disk on every request, so refresh after a new run. Stop it with Ctrl+C. Options: `--port <port>`, `--no-open`.

`memory-feature` also asks at the end whether to open the docs.

## Output

```
docs/memory/attendance/
├── README.md            what the feature does, APIs, code map, rules (Claude)
├── flow.md              steps that ran + the API calls each step made
├── api.md               every API: request body, response, status (sensitive keys → ***)
├── attendance.spec.ts   the Playwright test
├── feature.json         entry path + last run summary
└── video.webm           recording
```

## Config

```ts
// project-memory.config.ts
export default {
  baseUrl: 'http://localhost:3000',
  // startCommand: 'pnpm dev',   // start the app automatically if it isn't running
  apiPrefix: '/api',             // which fetch/XHR calls count as APIs ('' = all)
  auth: { username: process.env.MEMORY_USER ?? '', password: process.env.MEMORY_PASS ?? '' },
  mask: ['password', 'token', 'secret', 'authorization', 'cookie', 'phone', 'email'],
  outputDir: 'docs/memory',
  slowMo: 500,                   // ms before each browser action, so the run and video are easy to follow (0 = full speed)
};
```

## Privacy

API responses are saved into docs you commit. Values for the keys in `mask` are replaced with `***`, and lists are cut to 3 items. Headers and cookies are never saved. Run against a staging environment with test accounts.

## Try the demo

```bash
cd examples/school-demo
pnpm install
pnpm dev                                   # http://localhost:3456  (teacher / secret123)
pnpm memory-feature app/attendance/page.tsx
```

## Develop

```bash
pnpm install
pnpm dev        # tsc --watch
```

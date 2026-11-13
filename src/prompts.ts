/**
 * Prompts sent to Claude Code. The same text is used by the CLI ("Yes" path,
 * values filled in) and by the /memory-feature and /memory-readme slash
 * commands ("No" path, Claude works the values out itself).
 */

interface ScanVars {
  name: string;
  entry: string;
  specPath: string;
}

function scanBody(v: ScanVars): string {
  return `You are documenting a frontend feature for the project-memory tool.

Feature name: ${v.name}
Entry: ${v.entry}
Write the test to: ${v.specPath}

## What to do

1. Read the entry (if it is a folder, read the files in it) and follow its LOCAL imports:
   components, hooks, services, API clients, types. Skip node_modules.
   The backend is NOT in this repo — only read frontend code.
2. Work out the main user flow: what a user does on this page, from opening it
   to finishing the main task (e.g. open page → select class → mark students → save).
3. Find the URL route of this page (file-system route, router config, links to it).
4. Write ONE Playwright test file at the path above, using exactly this shape:

\`\`\`ts
import { test, expect, step, credentials } from '../fixture';

test('${v.name}: main flow', async ({ page }) => {
  await step('Log in', async () => {
    // only if the page needs auth — use credentials.username / credentials.password
  });

  await step('Open the page', async () => {
    await page.goto('/the-route');
  });

  // ...one step() per user action...
});
\`\`\`

## Rules

- Import from '../fixture' exactly as shown (it records the APIs and the video). Never import from '@playwright/test' directly.
- Wrap EVERY user action in step('<short human description>', ...). Steps are flat — never nest them.
  Step titles become the documentation, so write them for humans: "Select class Grade 5A", "Mark Sok Dara as present", "Click Save".
- Locators: prefer getByRole / getByLabel / getByPlaceholder / getByText using the real text you saw in the code.
  Use getByTestId only if data-testid exists. Avoid CSS classes.
- Use relative URLs in page.goto (baseURL is already configured).
- Add a few expect() checks that prove the action worked (success message, row appears, etc.).
- Only create the test file. Do NOT modify app code or any other file.

When you are done, reply with a short summary: the steps you chose, and anything you were unsure about
(e.g. text you guessed, data the test needs to exist).`;
}

export function scanPrompt(v: ScanVars): string {
  return scanBody(v);
}

interface ReadmeVars {
  name: string;
  entry: string;
  dir: string;
}

function readmeBody(v: ReadmeVars): string {
  return `You are documenting a frontend feature for the project-memory tool.

Feature name: ${v.name}
Entry: ${v.entry}
Docs folder: ${v.dir}

Read:
- the entry and the local files it imports (frontend only — the backend is not in this repo)
- ${v.dir}/flow.md (steps recorded by Playwright)
- ${v.dir}/api.md (API calls recorded during the run)
- the *.spec.ts test in ${v.dir}

Then write ${v.dir}/README.md for frontend developers with these sections:

# <Feature title>
One or two sentences: what this feature is and who uses it.

## What it does
Short bullet list of the capabilities you found in the code.

## User flow
The main flow in numbered steps. Link to [flow.md](flow.md) and [the video](video.webm).

## APIs
Table: Method | Path | Used for. Link to [api.md](api.md) for request/response details.

## Code map
Table: File | Role — the main files and what each one does.

## Rules & validations
Validations, permissions, empty/error states and business rules you found in the code.

## Not covered by the recorded flow
Actions, buttons or API calls that exist in the code but were not part of the recorded test.

Only describe what the code and the recordings show. If you are guessing, say so.
Write README.md only — do not modify any other file. Reply with a one-line summary when done.`;
}

export function readmePrompt(v: ReadmeVars): string {
  return readmeBody(v);
}

/** .claude/commands/memory-feature.md — used when the user answers "No" and runs it in VS Code. */
export function memoryFeatureCommand(runCommand = 'pnpm memory-feature $ARGUMENTS'): string {
  return `---
description: Scan a feature and write its project-memory Playwright test
argument-hint: <path to page or folder, e.g. app/attendance/page.tsx>
allowed-tools: Read, Glob, Grep, Write
---

First work out these values from \`$ARGUMENTS\`:
- **Entry**: \`$ARGUMENTS\`
- **Feature name**: the parent folder of the entry file in kebab-case (for app/attendance/page.tsx → attendance).
  If the file has a meaningful name (e.g. AttendancePage.tsx) use that without the Page suffix → attendance.
  Skip folders like [id], (group), app, src, pages.
- **Docs folder**: \`outputDir\` from project-memory.config.ts (default \`docs/memory\`) + \`/<feature name>\`
- **Test path**: \`<docs folder>/<feature name>.spec.ts\`

Feel free to discuss the flow with the user before writing the test.

${scanBody({
  name: '<feature name>',
  entry: '$ARGUMENTS',
  specPath: '<test path>',
})}

Finally, tell the user to run: \`${runCommand}\` — it will open Playwright so they can click ▶ Run.
`;
}

/** .claude/commands/memory-readme.md */
export function memoryReadmeCommand(): string {
  return `---
description: Write README.md for a feature recorded by project-memory
argument-hint: <feature name, e.g. attendance>
allowed-tools: Read, Glob, Grep, Write
---

The docs folder is \`outputDir\` from project-memory.config.ts (default \`docs/memory\`) + \`/$ARGUMENTS\`.
Read \`feature.json\` in that folder to find the entry path.

${readmeBody({
  name: '$ARGUMENTS',
  entry: '<entry from feature.json>',
  dir: '<docs folder>',
})}
`;
}

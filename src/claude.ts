import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { dim, cyan } from './ui.js';

/** Returns the Claude Code version, or null if `claude` is not installed. */
export function claudeVersion(): string | null {
  const result = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

function showTool(name: string, input: Record<string, unknown>, cwd: string): void {
  const rel = (p: unknown) => (typeof p === 'string' ? path.relative(cwd, p) || p : '');
  switch (name) {
    case 'Read':
      console.log(dim(`    read    ${rel(input.file_path)}`));
      break;
    case 'Glob':
      console.log(dim(`    find    ${input.pattern ?? ''}`));
      break;
    case 'Grep':
      console.log(dim(`    search  "${input.pattern ?? ''}"`));
      break;
    case 'Write':
    case 'Edit':
      console.log(`    ${cyan('write')}   ${rel(input.file_path)}`);
      break;
    default:
      console.log(dim(`    ${name.toLowerCase()}`));
  }
}

export interface ClaudeResult {
  ok: boolean;
  text: string;
}

/**
 * Run Claude Code headless (`claude -p`) in the project, using the user's own
 * Claude Code login — no API key. Claude may read files and write files;
 * it cannot run shell commands.
 */
export function runClaude(prompt: string, cwd: string): Promise<ClaudeResult> {
  return new Promise((resolve) => {
    const child = spawn(
      'claude',
      [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', 'acceptEdits',
        // Only these tools exist for this session — no shell, no web.
        '--tools', 'Read,Glob,Grep,Write,Edit',
        '--allowedTools', 'Read,Glob,Grep,Write,Edit',
      ],
      { cwd, stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let buffer = '';
    let stderr = '';
    let resultText = '';
    let isError = false;
    let gotResult = false;

    const handleLine = (line: string) => {
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === 'assistant') {
        for (const block of event.message?.content ?? []) {
          if (block.type === 'tool_use') showTool(block.name, block.input ?? {}, cwd);
        }
      } else if (event.type === 'result') {
        gotResult = true;
        resultText = typeof event.result === 'string' ? event.result : '';
        isError = Boolean(event.is_error) || event.subtype !== 'success';
      }
    };

    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (line) handleLine(line);
      }
    });
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (err) => resolve({ ok: false, text: err.message }));
    child.on('close', (code) => {
      if (buffer.trim()) handleLine(buffer.trim());
      resolve({
        ok: code === 0 && gotResult && !isError,
        text: resultText || stderr.trim() || `claude exited with code ${code}`,
      });
    });

    child.stdin.end(prompt);
  });
}

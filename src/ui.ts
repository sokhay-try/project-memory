import readline from 'node:readline/promises';

const color = (code: number) => (s: string) =>
  process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;

export const bold = color(1);
export const dim = color(2);
export const red = color(31);
export const green = color(32);
export const yellow = color(33);
export const cyan = color(36);

export const log = {
  title: (m: string) => console.log(`\n${bold(m)}`),
  info: (m: string) => console.log(`${cyan('›')} ${m}`),
  ok: (m: string) => console.log(`${green('✔')} ${m}`),
  warn: (m: string) => console.log(`${yellow('!')} ${m}`),
  error: (m: string) => console.error(`${red('✖')} ${m}`),
  plain: (m: string) => console.log(m),
};

/** Ask a yes/no question. Returns the default when not running in a terminal. */
export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  if (!process.stdin.isTTY) return defaultYes;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const hint = dim(defaultYes ? '(Y/n)' : '(y/N)');
    const answer = (await rl.question(`${cyan('?')} ${bold(question)} ${hint} `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

/** Print a block of text indented, e.g. Claude's summary. */
export function box(text: string): void {
  for (const line of text.trim().split('\n')) console.log(`  ${dim('│')} ${line}`);
}

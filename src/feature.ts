import path from 'node:path';

/** File names that say nothing about the feature, e.g. Next.js `page.tsx`. */
const GENERIC_FILES = new Set(['page', 'index', 'layout', 'route', 'view', 'screen', 'main', 'default', '+page']);

/** Folder names that are structure, not a feature. */
const GENERIC_DIRS = new Set(['app', 'src', 'pages', 'views', 'screens', 'features', 'modules', 'routes', 'components']);

function isSpecialSegment(seg: string): boolean {
  // Next.js dynamic [id] / [...slug], route groups (dashboard), parallel routes @modal
  return /^\[.*\]$/.test(seg) || /^\(.*\)$/.test(seg) || seg.startsWith('@');
}

export function toKebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function toTitle(kebab: string): string {
  return kebab
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Work out the feature name from the entry path.
 *   app/attendance/page.tsx             -> attendance
 *   app/(school)/attendance/[id]/page.tsx -> attendance
 *   src/pages/AttendancePage.tsx        -> attendance
 *   src/features/attendance             -> attendance
 */
export function featureNameFromPath(entry: string, isDir: boolean): string {
  const segments = entry.split(/[\\/]/).filter(Boolean);

  if (!isDir) {
    const file = segments.pop() ?? '';
    const base = path.parse(file).name;
    if (!GENERIC_FILES.has(base.toLowerCase())) {
      const name = toKebab(base).replace(/-(page|screen|view|container)$/, '');
      if (name) return name;
    }
  }

  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (isSpecialSegment(seg) || GENERIC_DIRS.has(seg.toLowerCase())) continue;
    const name = toKebab(seg);
    if (name) return name;
  }
  return 'home';
}

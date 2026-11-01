import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Guards against dead internal links.
 *
 * The admin account menu shipped `href="/account"` and `href="/settings"`
 * for two pages that were never created: `next build && output: 'export'`
 * still succeeds (it cannot see `<Link>` targets), so nothing caught it until
 * an operator clicked the item and got nginx's 404 in production.
 */

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS: Record<string, true> = { node_modules: true, out: true, '.next': true, '.git': true };

function walk(dir: string, exts: string[], acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    if (SKIP_DIRS[entry]) continue;
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, exts, acc);
    else if (exts.some((ext) => entry.endsWith(ext))) acc.push(full);
  }
  return acc;
}

/** `/customers/[id]` → `/customers/:param`, `/` stays `/`. */
function normalizeRoute(route: string): string {
  const trimmed = route.replace(/\/index$/, '') || '/';
  return trimmed.replace(/\[[^\]]+\]/g, ':param').replace(/\/$/, '') || '/';
}

/** `/customers/${id}?tab=x` → `/customers/:param`. */
function normalizeHref(href: string): string {
  const withoutQuery = href.split(/[?#]/)[0];
  const withParams = withoutQuery.replace(/\$\{[^}]+\}/g, ':param').replace(/\/\d+(?=\/|$)/g, '/:param');
  return withParams.replace(/\/$/, '') || '/';
}

const pageRoutes = new Set(
  walk(path.join(ROOT, 'pages'), ['.tsx'])
    .map((file) => path.relative(path.join(ROOT, 'pages'), file).replace(/\.tsx$/, ''))
    .filter((route) => !route.startsWith('_'))
    .map((route) => normalizeRoute(`/${route}`))
);

/** Internal hrefs that are not app routes: subscription endpoints, API, anchors. */
const NON_ROUTE_PREFIXES = ['#', '/api', '/c/'];

describe('internal links', () => {
  it('point at pages that exist', () => {
    const sources = [
      ...walk(path.join(ROOT, 'components'), ['.tsx']),
      ...walk(path.join(ROOT, 'pages'), ['.tsx']),
    ];

    const dead: string[] = [];
    for (const file of sources) {
      const source = fs.readFileSync(file, 'utf8');
      const hrefs = source.matchAll(/href=(?:"([^"]*)"|\{[`'"]([^`'"]*)[`'"]\})/g);
      for (const match of hrefs) {
        const href = match[1] ?? match[2];
        if (!href.startsWith('/') || href.startsWith('//')) continue;
        if (NON_ROUTE_PREFIXES.some((prefix) => href.startsWith(prefix))) continue;
        const route = normalizeHref(href);
        if (!pageRoutes.has(route)) {
          dead.push(`${path.relative(ROOT, file)} → ${href}`);
        }
      }
    }

    expect(dead).toEqual([]);
  });
});

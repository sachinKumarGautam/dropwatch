/**
 * fixtures.ts — load checked-in fixtures for DRY_RUN / tests.
 * Resolves canonical URLs → { html, markdown } via fixtures/manifest.json.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { FixtureEntry } from "./scrape/router.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = resolve(HERE, "..", "fixtures");

type Manifest = Record<string, { html?: string; markdown?: string }>;

export function createFixtureResolverFromDir(
  dir = FIXTURE_DIR,
): (url: string) => FixtureEntry | null {
  const manifestPath = join(dir, "manifest.json");
  const manifest: Manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : {};
  const cache = new Map<string, FixtureEntry | null>();
  return (url: string): FixtureEntry | null => {
    if (cache.has(url)) return cache.get(url)!;
    const entry = manifest[url];
    let result: FixtureEntry | null = null;
    if (entry) {
      result = {
        html: entry.html ? readFileSync(join(dir, entry.html), "utf8") : undefined,
        markdown: entry.markdown
          ? readFileSync(join(dir, entry.markdown), "utf8")
          : undefined,
      };
    }
    cache.set(url, result);
    return result;
  };
}

export function readFixture(rel: string, dir = FIXTURE_DIR): string {
  return readFileSync(join(dir, rel), "utf8");
}

export function readFixtureJson<T = unknown>(rel: string, dir = FIXTURE_DIR): T {
  return JSON.parse(readFixture(rel, dir)) as T;
}

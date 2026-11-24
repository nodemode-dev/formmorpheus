import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from '@src/version';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative: string): string => readFileSync(resolve(REPO, relative), 'utf-8');

describe('the version sites', () => {
  it('is three dot separated integers', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is the same in the interface, its package file and its lock file', () => {
    const pkg = JSON.parse(read('frontend/package.json'));
    const lock = JSON.parse(read('frontend/package-lock.json'));
    expect(pkg.version).toBe(VERSION);
    expect(lock.version).toBe(VERSION);
    expect(lock.packages[''].version).toBe(VERSION);
  });

  it('is the same in the engine, the desktop shell, the iPad project and the API contract', () => {
    expect(read('backend/app/__init__.py')).toContain(`__version__ = "${VERSION}"`);
    expect(JSON.parse(read('src-tauri/tauri.conf.json')).version).toBe(VERSION);
    expect(read('src-tauri/Cargo.toml')).toMatch(new RegExp(`^version = "${VERSION.replace(/\./g, '\\.')}"$`, 'm'));
    expect(read('ios/project.yml')).toContain(`MARKETING_VERSION: "${VERSION}"`);
    expect(JSON.parse(read('docs/api-contract.json')).info.version).toBe(VERSION);
  });

  it('heads the changelog and the README badge', () => {
    expect(read('CHANGELOG.md')).toMatch(new RegExp(`^## ${VERSION.replace(/\./g, '\\.')} `, 'm'));
    expect(read('README.md')).toContain(`version-v${VERSION}-`);
  });
});

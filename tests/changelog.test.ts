import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { changelogSection } from '../scripts/lib/changelog.ts';

const sample = `# Changelog

## 0.2.0

- New thing

## 0.1.1

Fixes
- Fix A
- Fix B

## 0.1.0

First release.
`;

describe('changelogSection', () => {
  it('extracts a version section without its heading', () => {
    expect(changelogSection(sample, '0.1.1')).toBe('Fixes\n- Fix A\n- Fix B');
    expect(changelogSection(sample, 'v0.2.0')).toBe('- New thing');
    expect(changelogSection(sample, '0.1.0')).toBe('First release.');
  });
  it('returns null for versions without an entry, and does not match prefixes', () => {
    expect(changelogSection(sample, '0.3.0')).toBeNull();
    expect(changelogSection(sample, '0.1')).toBeNull();
  });
  it('has an entry for the current package version', () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const log = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
    expect(changelogSection(log, pkg.version)).not.toBeNull();
  });
});

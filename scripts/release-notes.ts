// Prints GitHub Release notes for a version from CHANGELOG.md.
//   node scripts/release-notes.ts <version> [previousTag]
// Exits non-zero when the changelog has no entry for the version.
import fs from 'node:fs';
import { changelogSection } from './lib/changelog.ts';

const [version, previous] = process.argv.slice(2);
if (!version) {
  console.error('usage: release-notes <version> [previousTag]');
  process.exit(2);
}
const body = changelogSection(fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), version);
if (!body) {
  console.error(`CHANGELOG.md has no "## ${version.replace(/^v/, '')}" section`);
  process.exit(1);
}
const tag = `v${version.replace(/^v/, '')}`;
const repo = 'https://github.com/Hexbit-Studios/asset-review';
const npm = `https://www.npmjs.com/package/@hexbit/asset-review/v/${tag.slice(1)}`;
const footer = previous
  ? `**Full changelog**: ${repo}/compare/${previous}...${tag}`
  : `**Full changelog**: ${repo}/commits/${tag}`;
console.log(`${body}\n\n---\n\nInstall: \`npm install -g @hexbit/asset-review@${tag.slice(1)}\` · [npm](${npm})\n\n${footer}`);

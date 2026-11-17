// Pull one version's section out of CHANGELOG.md (used for GitHub Release notes).

/** Body of the `## <version>` section (without the heading), or null if there isn't one. */
export function changelogSection(changelog: string, version: string): string | null {
  const v = version.replace(/^v/, '');
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+\\[?v?${v.replace(/\./g, '\\.')}\\]?(\\s|$)`).test(l));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || null;
}

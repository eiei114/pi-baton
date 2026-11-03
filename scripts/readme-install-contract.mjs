/**
 * Shared contract for the pinned install example in README.md.
 *
 * `package.json`'s version is not installable just because it was merged: a
 * version change on `main` publishes nothing until a maintainer explicitly
 * dispatches the release workflow (see docs/release.md and
 * tests/smoke.test.mjs' release workflow guard). The offline unit test can only
 * compare README against this tree, so it enforces the documentation half:
 * whenever the pinned example is not this tree's version, README must label the
 * tree's version as not yet installable rather than presenting it as working.
 * `scripts/check-readme-install.mjs` closes the remaining gap against the
 * registry.
 */

export const PINNED_INSTALL_PATTERN = /pi install npm:([a-z0-9@/._-]+)@(\d+\.\d+\.\d+)/i;

const UNPUBLISHED_LABEL_PATTERN = /\b(not yet published|not yet released|upcoming)\b/i;

/** Character window searched on either side of a version mention for a label. */
const LABEL_WINDOW = 400;

function isDigit(char) {
  return char !== undefined && char >= "0" && char <= "9";
}

/**
 * Parse the pinned `pi install npm:<name>@<version>` example out of README text.
 * @param {string} readme
 * @returns {{ packageName: string, version: string, index: number } | null}
 */
export function parsePinnedInstall(readme) {
  const match = readme.match(PINNED_INSTALL_PATTERN);
  if (!match) return null;
  return { packageName: match[1], version: match[2], index: match.index ?? 0 };
}

/**
 * True when some standalone mention of `version` sits next to an "unpublished"
 * label, so a reader copying the pinned command learns it is not installable.
 * @param {string} text
 * @param {string} version
 * @returns {boolean}
 */
export function labelsVersionAsUnpublished(text, version) {
  if (!version) return false;

  let from = 0;
  for (;;) {
    const index = text.indexOf(version, from);
    if (index === -1) return false;

    const before = index === 0 ? undefined : text[index - 1];
    const after = text[index + version.length];
    const standalone = !isDigit(before) && before !== "." && !isDigit(after) && after !== ".";

    if (standalone) {
      const window = text.slice(
        Math.max(0, index - LABEL_WINDOW),
        Math.min(text.length, index + version.length + LABEL_WINDOW),
      );
      if (UNPUBLISHED_LABEL_PATTERN.test(window)) return true;
    }

    from = index + version.length;
  }
}

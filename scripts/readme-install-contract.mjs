/**
 * Shared contract for the pinned install example in README.md.
 *
 * `package.json`'s version is not installable just because it was merged: a
 * version change on `main` publishes nothing until a maintainer completes an
 * explicit, maintainer-controlled release action (see docs/release.md and
 * tests/smoke.test.mjs' release workflow guard). The offline unit test can only
 * compare README against this tree, so it enforces the documentation half:
 * whenever the pinned example is not this tree's version, README must label the
 * tree's version as not yet installable rather than presenting it as working.
 * `scripts/check-readme-install.mjs` closes the remaining gap against the
 * registry.
 */

/**
 * Complete version token, including prerelease and build metadata, so a pin like
 * `0.9.2-beta.1` is never silently truncated to `0.9.2`. A truncated capture would
 * probe the stable version and could pass while the copied command fails.
 */
export const VERSION_TOKEN_PATTERN = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/g;

/** Strict semver check for a captured version token. */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const PINNED_INSTALL_PATTERN =
  /pi install npm:([a-z0-9@/._-]+?)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/i;

const UNPUBLISHED_LABEL_PATTERN = /\b(not yet published|not yet released|upcoming)\b/gi;

/**
 * Sentence-ish segments. A label describes a version mention inside the same
 * sentence, so the search never reaches across a sentence boundary into a
 * neighbouring version's status.
 */
const SEGMENT_SPLIT_PATTERN = /(?<=[.!?])\s+/;

/**
 * Every version token in `text`, in order, with its offset.
 * @param {string} text
 * @returns {{ version: string, index: number }[]}
 */
function versionMentions(text) {
  const pattern = new RegExp(VERSION_TOKEN_PATTERN.source, "g");
  const mentions = [];
  for (const match of text.matchAll(pattern)) {
    mentions.push({ version: match[0], index: match.index ?? 0 });
  }
  return mentions;
}

/**
 * Parse the pinned `pi install npm:<name>@<version>` example out of README text.
 * The captured version is the complete token, and it must be valid semver.
 * @param {string} readme
 * @returns {{ packageName: string, version: string, index: number } | null}
 */
export function parsePinnedInstall(readme) {
  const match = readme.match(PINNED_INSTALL_PATTERN);
  if (!match) return null;
  if (!SEMVER_PATTERN.test(match[2])) return null;
  return { packageName: match[1], version: match[2], index: match.index ?? 0 };
}

/**
 * True when an "unpublished" marker describes the same version mention as
 * `version`, so a reader copying the pinned command learns it is not installable.
 *
 * The label is bound to the version it describes rather than to any version
 * within a fixed character window: README documents both the newest published
 * version and the next unpublished one right next to each other, and a window
 * would let the unpublished marker reclassify the published pin (turning a 404
 * probe of the pinned version into a false success).
 * @param {string} text
 * @param {string} version
 * @returns {boolean}
 */
export function labelsVersionAsUnpublished(text, version) {
  if (!version) return false;

  for (const segment of text.split(SEGMENT_SPLIT_PATTERN)) {
    const labelPattern = new RegExp(UNPUBLISHED_LABEL_PATTERN.source, "gi");
    const labels = [...segment.matchAll(labelPattern)];
    if (labels.length === 0) continue;

    const mentions = versionMentions(segment);
    if (mentions.length === 0) continue;

    for (const label of labels) {
      const labelIndex = label.index ?? 0;
      // A marker describes the version mentioned immediately before it; when it
      // introduces the mention instead ("not yet published: 0.9.3"), the first
      // mention of the sentence is its subject.
      const preceding = mentions.filter((mention) => mention.index < labelIndex).at(-1);
      const subject = preceding ?? mentions[0];
      if (subject.version === version) return true;
    }
  }

  return false;
}

/**
 * Decide whether the README's pinned install command is safe to copy, given the
 * registry status for that exact specifier.
 *
 * Pure and offline so `tests/smoke.test.mjs` can assert the 404 paths that used
 * to report success. A README that pins a different package name is rejected
 * before any registry lookup: the same version can exist for another package, so
 * a 200 would otherwise validate a command that installs the wrong package.
 * @param {{ readme: string, manifest: { name: string, version: string }, status: number }} input
 * @returns {{ ok: boolean, reason: string, pinned: { packageName: string, version: string } | null }}
 */
export function evaluatePinnedInstall({ readme, manifest, status }) {
  const pinned = parsePinnedInstall(readme);
  if (!pinned) {
    return { ok: false, reason: "missing-pin", pinned: null };
  }

  if (pinned.packageName !== manifest.name) {
    return { ok: false, reason: "name-mismatch", pinned };
  }

  if (status === 200) {
    return { ok: true, reason: "published", pinned };
  }

  if (status === 404) {
    return labelsVersionAsUnpublished(readme, pinned.version)
      ? { ok: true, reason: "labeled-unpublished", pinned }
      : { ok: false, reason: "unpublished-unspecified", pinned };
  }

  return { ok: false, reason: "unexpected-status", pinned };
}

# Release

This package uses npm Trusted Publishing with GitHub Actions OIDC.

Do not add `NPM_TOKEN` or long-lived npm tokens to GitHub Secrets.

## One-time npm setup

On npmjs.com, configure Trusted Publishing for this package:

- Publisher: GitHub Actions
- Repository: this GitHub repository
- Workflow filename: `publish.yml`

## Release and publish

Package version changes merged to `main` never create a tag, GitHub Release, or npm publication automatically. After review, a maintainer may explicitly dispatch `.github/workflows/auto-release.yml` on `main`. It checks for a new package version, creates its tag and GitHub Release, then explicitly dispatches `.github/workflows/publish.yml` for that tag. Do not dispatch this workflow as part of routine implementation or verification.

The `v*.*.*` tag push also triggers `.github/workflows/publish.yml`. Publishing can also be run by publishing a GitHub Release or explicitly dispatching the workflow. These are maintainer-controlled release actions.

The workflow skips `name@version` if that exact package version already exists on npm.

## Workflow guardrail

Do not ship a new Pi OSS package or version bump with only `package.json` changes.
The repository must keep release and publication behind an explicit maintainer action:

- `.github/workflows/auto-release.yml` is manually dispatched on `main` to create `v<version>` tags and GitHub Releases.
- `.github/workflows/publish.yml` publishes to npm through Trusted Publishing.

Important: tags or releases created by `GITHUB_TOKEN` do not reliably fan out into another workflow through normal `push.tags` or `release.published` triggers. `auto-release.yml` explicitly dispatches `publish.yml` after a maintainer starts a release. If you change the release flow, keep one explicit handoff path: `workflow_dispatch` from auto-release, `repository_dispatch`, or `workflow_run` on the auto-release workflow.

## GitHub Actions requirements

- `permissions: id-token: write`
- `permissions: actions: write` on auto-release so it can dispatch `publish.yml`
- `auto-release.yml` must run only on explicit maintainer dispatch and call `gh workflow run publish.yml --ref "$TAG" -f ref="$TAG"`, or `publish.yml` must have an equivalent explicit handoff trigger such as `workflow_run`
- GitHub-hosted runner
- Node.js 24, so the release job uses a current npm CLI for Trusted Publishing
- No `NPM_TOKEN`
- `npm publish` from the configured workflow file

## First release checklist

- [ ] `package.json` name is final
- [ ] `repository.url` points to the real GitHub repository
- [ ] npm Trusted Publisher is configured
- [ ] `npm run ci` passes
- [ ] `npm pack --dry-run` contains only intended files
- [ ] CHANGELOG.md has the release date


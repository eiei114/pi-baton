# Contributing

Thanks for helping improve this Pi package.

## Development

```bash
npm install
npm run ci
```

## Local Pi testing

```bash
pi -e .
```

## Pull requests

Before opening a PR:

- Run `npm run ci`
- Update docs when behavior changes
- Update `CHANGELOG.md` for user-facing changes
- Keep package contents small and intentional

## Release

Releases use npm Trusted Publishing. Do not add `NPM_TOKEN` to GitHub Secrets.
Package-version changes do not release automatically: after a reviewed change is
merged, a maintainer explicitly dispatches the release workflow on `main` when a
release is authorized. See [`docs/release.md`](docs/release.md) for details.

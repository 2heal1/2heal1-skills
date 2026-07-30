# npm OIDC release reference

This reference turns an npm release request into a safe, repeatable implementation plan.

## Repository discovery

Start with read-only inspection:

```bash
git status --short --branch
rg -n "release|publish|trusted|oidc|provenance|otp|npm trust|npm publish" package.json .github docs scripts .changeset --glob '!node_modules/**' --glob '!dist/**'
```

Then inspect the files that actually exist:

- root `package.json` and package-level `package.json` files;
- package manager lockfile and workspace config;
- `.npmrc`, if present;
- existing `.github/workflows/*.yml`;
- release docs under `docs/`;
- release scripts under `scripts/`.

Prefer the repository's own publish script over direct `npm publish`. Release scripts often encode package order, skipped versions, version consistency, archive checks, and retry behavior.

## `release.yml` requirements for npm trusted publishing

For GitHub Actions trusted publishing:

- use a GitHub-hosted runner such as `ubuntu-latest`;
- grant `id-token: write`;
- grant at least `contents: read`; use `contents: write` only if the workflow also creates tags or GitHub Releases;
- configure `actions/setup-node` with `registry-url: https://registry.npmjs.org`;
- use Node.js 22.14.0 or newer and npm 11.5.1 or newer; if the repository pins newer versions, use the repository pin;
- do not set `NODE_AUTH_TOKEN` or `NPM_TOKEN` for the publish step unless the user explicitly chooses token-based publishing;
- call the repository's publish script or `npm publish` from the workflow that npm has been configured to trust.

The workflow filename configured in npm must be only the filename, such as `release.yml`, not `.github/workflows/release.yml`.

Minimal single-package workflow:

```yaml
name: Publish Package

on:
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: "24"
          registry-url: "https://registry.npmjs.org"
          package-manager-cache: false
      - run: npm ci
      - run: npm run build --if-present
      - run: npm test --if-present
      - run: npm publish --access public
```

For a pnpm workspace, keep the same OIDC requirements but use the repository's selected pnpm version and publish script:

```yaml
name: Publish Release

on:
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v6
        with:
          node-version: "24"
          registry-url: "https://registry.npmjs.org"
          package-manager-cache: false
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build
      - run: pnpm run publish:packages
```

Adapt triggers to the repository's release model. Common valid choices are `workflow_dispatch`, release-branch merge, tag push, or GitHub Release publication. Do not change the trigger style without a reason tied to the repository's current process.

## Trusted publisher setup

Trusted publishing can only be configured after a package exists on npm.

For GitHub Actions:

```bash
npm trust github <package-name> --repo <owner>/<repo> --file release.yml --allow-publish --yes
```

If the workflow uses a GitHub environment, include it exactly:

```bash
npm trust github <package-name> --repo <owner>/<repo> --file release.yml --env <environment-name> --allow-publish --yes
```

Rules:

- owner, repo, workflow filename, and environment are case-sensitive;
- each package can have only one trusted publisher at a time;
- use `--allow-publish` for normal publishing;
- do not configure `--allow-stage-publish` unless the repository actually uses npm staged publishing;
- if `npm trust` asks for authentication or proof of presence, ask the user for the required OTP at that moment and use it once.

## Local bootstrap publishing with OTP

Use local publishing only when a package name must be created before trusted publishing can be configured, or when the user explicitly asks for a local release.

Preflight:

```bash
npm whoami --registry https://registry.npmjs.org
npm --version
node --version
```

Use the repository's install, build, and test commands. Then pack and inspect the archive before publishing:

```bash
npm pack --dry-run
```

For workspaces, prefer producing `.tgz` archives and publishing those exact archives:

```bash
pnpm --dir <package-dir> pack --pack-destination /tmp/npm-bootstrap
npm publish /tmp/npm-bootstrap/<archive>.tgz --access public --registry https://registry.npmjs.org --otp <code>
```

For Divebell-shaped repositories:

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run release:npm:pack -- --output-dir /tmp/divebell-npm-bootstrap
pnpm run publish:packages -- --output-dir /tmp/divebell-npm-bootstrap --otp <code>
```

If a multi-package publish is interrupted because the OTP expired, rerun the same repository publish command with a fresh OTP. A good publish script should skip versions already present on npm; verify that behavior before retrying.

## Provenance

With npm trusted publishing from a supported public GitHub Actions workflow, npm generates provenance automatically for public packages. Do not add `--provenance` merely to make trusted publishing work.

Use `--provenance` only when deliberately using npm provenance without trusted publishing and the publish is running on a supported cloud CI runner.

When the exact npm behavior matters, verify against the current official npm docs:

- https://docs.npmjs.com/trusted-publishers/
- https://docs.npmjs.com/cli/v11/commands/npm-trust/
- https://docs.npmjs.com/generating-provenance-statements/

## Validation checklist

Before changing files:

- confirm the working tree state and avoid unrelated user changes;
- identify the package names and versions that would be published;
- confirm the intended npm registry and tag.

After editing `release.yml`:

- verify it is under `.github/workflows/release.yml`;
- verify `permissions.id-token: write`;
- verify the runner is GitHub-hosted;
- verify the workflow filename matches the `npm trust github --file` value;
- run any repository release workflow tests if present.

Before local publish:

- build and test using repository commands;
- pack first and inspect package names, versions, files, and workspace dependency rewrites;
- ask for OTP only when the next step is the real publish.

After publish:

```bash
npm view <package-name>@<version> version --json --registry https://registry.npmjs.org
npm view <package-name> dist-tags --json --registry https://registry.npmjs.org
```

Report exactly what was published, what was skipped, what trusted publisher config was created, and what still needs the user's npm account UI action, if any.

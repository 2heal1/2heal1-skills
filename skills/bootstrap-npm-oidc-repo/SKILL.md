---
name: bootstrap-npm-oidc-repo
description: Initialize an empty or placeholder GitHub repository as a publishable npm package and orchestrate CI, Changesets preview releases, release pull requests, initial OTP-assisted npm publishing, and GitHub Actions trusted publishing with OIDC. Use when Codex must bootstrap package metadata and package-manager files, add pnpm or npm CI, publish an explicitly chosen initial version, configure npm trusted publishing, or hand off a repository whose product code will be built later.
---

# Bootstrap npm OIDC Repository

Prepare a package repository for contributors without inventing its product
implementation. Leave it able to validate changes, publish preview versions,
create a release pull request, and publish automatically after that pull request
is merged.

## Load the publishing dependency

Before any npm publish, dist-tag, unpublish, or trusted-publishing action, read:

- `../npm-oidc-release/SKILL.md`
- The npm OIDC reference that skill directs you to read

Treat that sibling skill as the authority for npm authentication, OTP timing,
trusted-publisher creation, and post-publish verification. This skill adds the
repository bootstrap and release orchestration around it. If the sibling skill
is unavailable, preserve the same safety boundaries and verify current commands
against official npm documentation before making external changes.

Read [references/repository-contract.md](references/repository-contract.md)
before creating or changing repository files.

## Define completion before editing

Write a short task checklist that makes these outcomes explicit:

- Package identity, initial version, registry, access, repository, and package
  manager are confirmed rather than guessed.
- One package manager and one matching lockfile are used everywhere.
- Pull requests and `main` run a frozen install, checks, and a package-content
  inspection.
- A branch can publish an isolated preview version.
- Merging a normal pull request creates or updates a release pull request.
- Merging the release pull request publishes the stable version through OIDC.
- No long-lived npm token is stored in repository settings or workflows.
- The initial package and its online metadata are verified when publication is
  part of the request.

Do not report completion until all in-scope items have been exercised or an
external blocker has been identified.

## 1. Inspect and confirm

Inspect the current branch, working tree, remotes, repository files, workflow
files, package metadata, lockfiles, and npm package state. Preserve unrelated
user changes.

Before the first real publication, explicitly establish all of the following:

- Exact package name
- Exact initial version
- `pnpm` or `npm`, including the pinned version
- Public or restricted access
- npm registry
- GitHub owner/repository
- Trusted workflow filename, normally `release.yml`
- Whether the package name/version already exists on npm

Never infer an initial version from a template or convention. `0.0.0` is a
common bootstrap choice, but use it only when the user selected it or the
repository already establishes it unambiguously. If required information was
already provided, do not ask for it again.

If the remote or package scope does not match the requested identity, stop
before publishing and resolve the discrepancy.

## 2. Establish one package-manager contract

Infer the package manager from `packageManager` and the committed lockfile.
Reconcile conflicts instead of allowing workflows to compensate for them.

For pnpm repositories:

- Commit only `pnpm-lock.yaml`.
- Pin `packageManager` to an exact `pnpm@x.y.z`.
- Set up that pnpm version in every workflow.
- Install with `pnpm install --frozen-lockfile`.
- Use pnpm in repository scripts and contributor instructions.
- Never leave `npm ci` in a workflow.

For npm repositories:

- Commit only `package-lock.json`.
- Pin `packageManager` to an exact `npm@x.y.z`.
- Install with `npm ci`.
- Never leave pnpm install commands in a workflow.

The release workflow can still install a current npm CLI because npm trusted
publishing depends on npm CLI support even when pnpm drives the project.

## 3. Initialize only the repository shell

Create the smallest honest package shell needed to validate and publish:

- `package.json` with the confirmed name/version, public publishing metadata,
  repository links, exact package manager, and real package entry points
- A matching lockfile
- Minimal source and test files only when the package would otherwise be
  unbuildable or untestable
- License, concise README, and `.gitignore`
- Build/check/prepack scripts that agree with the package contents

Do not design future APIs, add speculative dependencies, or claim features that
other contributors have not built. A placeholder export is acceptable when it
is clearly described as such.

Inspect the packed archive, not merely the source tree. Ensure it contains only
the intended distributable files and that entry points resolve after the build.

## 4. Build the CI and release flow

Create:

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.changeset/config.json`
- A short release guide such as `docs/releasing.md`

The CI workflow must run on pull requests and pushes to `main`, use a frozen
install, run repository checks, and inspect the package archive.

The release workflow must support two paths:

1. On pushes to `main`, use `changesets/action@v1` to create or update the
   release pull request. When no unreleased changesets remain, publish the stable
   package through the repository's release command.
2. On manual workflow dispatch from a selected branch, create a Changesets
   `preview` snapshot, update the lockfile without changing the branch, and
   publish with the npm `preview` tag and no Git tag.

Grant `id-token: write` only to jobs that publish. Grant the stable job the
GitHub permissions needed to update the release pull request. Do not add
`NPM_TOKEN`, `NODE_AUTH_TOKEN`, or an npm automation token.

Keep the trusted workflow filename stable. npm binds trust to the exact GitHub
owner, repository, workflow file, and optional environment.

The contributor guide should say only:

- Add and commit a changeset for a publishable change.
- Run the Release workflow on the branch to publish a preview.
- Merge the normal pull request to create/update the release pull request.
- Review and merge the release pull request to publish the stable version.

## 5. Validate before external writes

Run the included repository validator:

```sh
node <this-skill-directory>/scripts/validate_release_setup.mjs <repository>
```

Then run, using the repository's pinned tool versions:

1. Frozen dependency installation
2. Full checks
3. Build or prepack
4. Package dry run and archive inspection

Where practical, use a disposable working copy to exercise both Changesets
version paths: preview snapshot and normal release versioning. Do not let that
simulation alter the user's working tree.

Fix failures and rerun the full relevant sequence. A generated workflow that has
not been checked against the selected lockfile is not complete.

## 6. Publish the initial package and configure trust

Perform the dependency skill's complete preflight first. Ask for an OTP only
when the next command is the confirmed external write. Publish the exact archive
that was just inspected, verify the package/version and dist-tag online, then
configure the npm trusted publisher for the exact GitHub workflow.

Never repeat or record an OTP in a file, command transcript summary, commit, or
final response. If a current npm trust command accepts OTP only through npm
configuration, pass it through an ephemeral process environment and never
persist it.

Verify the resulting package metadata and trusted-publisher state when the
available authentication allows it. A successful creation response is useful
evidence but does not replace online package verification.

## 7. Handle a wrong bootstrap version safely

Package versions are immutable. If an incorrect bootstrap version was
published, do not remove it first and then try to reuse it.

1. Confirm the desired version.
2. Publish and verify the desired version.
3. Confirm the active dist-tag points to the desired version.
4. Only then, and with fresh user authorization and OTP, remove the incorrect
   version if npm permits it.
5. Verify the final online version and tag state.

Do not unpublish the entire package. Explain that a removed version number
cannot be reused.

## 8. Hand off

Report the files created or changed, the exact validation that passed, the
published package/version and tag when applicable, and whether trusted
publishing was verified. Mention any action the user still must take, such as
pushing a local commit.

Do not push, merge, publish, unpublish, create trust, or change repository
settings unless the user authorized that external action.

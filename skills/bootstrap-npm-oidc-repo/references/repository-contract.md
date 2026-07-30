# Repository contract

Use this reference when creating or reviewing a single-package npm repository
with Changesets and GitHub Actions trusted publishing.

## Required decisions

Resolve these values before a real publish:

| Decision | Requirement |
| --- | --- |
| Package | Exact npm name, including scope |
| Version | Exact initial version; never choose it implicitly |
| Access | `public` or `restricted` |
| Registry | Normally `https://registry.npmjs.org` |
| Manager | Exact pnpm or npm version |
| Repository | Exact GitHub owner and repository |
| Workflow | Exact filename trusted by npm, normally `release.yml` |
| Environment | Empty unless both workflow and npm trust use the same value |

Check whether the name or name/version already exists before publishing.

## Minimal file set

The usual single-package shell contains:

```text
.changeset/
  config.json
.github/workflows/
  ci.yml
  release.yml
docs/
  releasing.md
src/
package.json
pnpm-lock.yaml OR package-lock.json
README.md
LICENSE
.gitignore
```

Source, compiler configuration, and tests must reflect the actual package. Keep
placeholders small and explicit when contributors will build the implementation
later.

## Package metadata

Require:

- `name`
- Explicit `version`
- `license`
- Entry points that match packed build output
- A restrictive `files` list
- Exact `packageManager`
- `repository` pointing at the GitHub repository
- `publishConfig.access`
- `publishConfig.registry`
- A build/check path and `prepack` when a build is required
- `changeset`, version, and release scripts

For a public scoped package:

```json
{
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org"
  }
}
```

Do not add an npm token to `.npmrc`, package scripts, or GitHub secrets.

## Package-manager mapping

| Surface | pnpm repository | npm repository |
| --- | --- | --- |
| Metadata | `pnpm@x.y.z` | `npm@x.y.z` |
| Lockfile | `pnpm-lock.yaml` | `package-lock.json` |
| CI install | `pnpm install --frozen-lockfile` | `npm ci` |
| Run checks | `pnpm run check` | `npm run check` |
| Package dry run | `pnpm pack --dry-run` | `npm pack --dry-run` |
| Changesets | `pnpm exec changeset` | `npx changeset` |

All workflow jobs must follow the same column. A pnpm project may install a
supported npm CLI only for trusted publishing; that does not make `npm ci`
valid.

## CI contract

`.github/workflows/ci.yml` must:

- Trigger on `pull_request`
- Trigger on pushes to `main`
- Use `ubuntu-latest`
- Check out the repository
- Install the exact package manager
- Use the committed lockfile in frozen mode
- Run checks
- Inspect package contents with a dry-run pack

## Release workflow contract

`.github/workflows/release.yml` must:

- Trigger on pushes to `main`
- Support `workflow_dispatch`
- Use `ubuntu-latest`
- Set up Node with `registry-url: https://registry.npmjs.org`
- Use Node 22.14.0 or newer
- Use npm 11.5.1 or newer for trusted publishing
- Install dependencies from the committed lockfile
- Run checks before publishing
- Grant `id-token: write` in each publishing job
- Avoid `NPM_TOKEN` and `NODE_AUTH_TOKEN`

### Stable path

On a push to `main`:

1. `changesets/action@v1` creates or updates one release pull request when
   changeset files exist.
2. The action runs the repository's version command.
3. When the action reports no remaining changesets after the release pull
   request is merged, a separate shell step runs the repository's publish
   command.

Keep publishing outside the action's `publish` input. This avoids converting
the OIDC flow into a token-backed publish path.

The stable job needs:

```yaml
permissions:
  contents: write
  pull-requests: write
  id-token: write
```

`GITHUB_TOKEN` is allowed for the GitHub release pull request. It is not an npm
credential.

### Preview path

On manual dispatch from the selected branch:

1. Install and run checks.
2. Run `changeset version --snapshot preview`.
3. Update only the local lockfile.
4. Run `changeset publish --tag preview --no-git-tag`.
5. Put the exact install command in the workflow summary.

The preview job needs only:

```yaml
permissions:
  contents: read
  id-token: write
```

The workflow run must not commit snapshot changes to the branch. Stable
versioning remains driven by the committed changeset.

## Changesets configuration

Changesets access must match `publishConfig.access`. For a public package on a
`main` default branch, require:

```json
{
  "access": "public",
  "baseBranch": "main"
}
```

The exact changelog choice may vary. Do not add a release-group policy unless
the repository is a real multi-package workspace.

## Contributor handoff

Keep release instructions short:

1. Run the repository's Changesets command and commit the generated file.
2. For a preview, push the branch and manually run the Release workflow on that
   branch.
3. Merge the normal pull request; automation creates or updates the release
   pull request.
4. Review and merge the release pull request; automation publishes the stable
   version.

Do not tell contributors to create an npm token or run a normal stable publish
by hand.

## Validation sequence

Run:

1. The skill's `validate_release_setup.mjs`
2. Frozen install
3. Repository checks
4. Build/prepack
5. Pack dry run
6. Archive content inspection
7. Disposable preview-version simulation
8. Disposable stable-version simulation

After publishing, verify the package version, dist-tags, repository metadata,
and provenance/trusted-publisher state online.

## Recovery from a wrong initial version

npm versions cannot be overwritten. Avoid this unsafe order:

1. Remove wrong version.
2. Attempt to republish that same version.

Use this order:

1. Publish the correct, previously unused version.
2. Verify it.
3. Move or verify the intended dist-tag.
4. Request fresh authorization and OTP.
5. Remove only the wrong version if npm policy permits.
6. Verify the remaining versions and tags.

Never unpublish the entire package as a shortcut.

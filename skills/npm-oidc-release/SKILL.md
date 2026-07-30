---
name: npm-oidc-release
description: Set up and operate npm package releases using GitHub Actions trusted publishing/OIDC, repository release workflows, and OTP-assisted local bootstrap publishing. Use this when the user asks to create or fix release.yml, configure npm OIDC trusted publishing, publish a first package version locally, handle npm OTP during publishing, or make a reusable release flow for npm packages.
---

# npm-oidc-release

Use this skill to set up or run an npm release flow that prefers GitHub Actions trusted publishing with OIDC, while still supporting local bootstrap publishing when the user provides an npm one-time password.

## Safety rules

- Treat every real `npm publish`, `npm trust`, dist-tag change, GitHub Release mutation, and workflow deployment as an external write.
- Do not run a real publish unless the user has clearly asked for it and the package names, versions, registry, and tag are known.
- Never save, commit, print, or repeat an OTP. Use the OTP only for the single publish command that needs it. If it expires, ask for a new OTP.
- Do not add `NPM_TOKEN`, long-lived npm tokens, or npm auth secrets to `release.yml` when trusted publishing is the intended path.
- Preserve existing release scripts and release policy. Inspect the repository first and call the repo's own release command when it exists.
- Do not overwrite an existing package release or GitHub Release unless the repository's release script explicitly makes that operation safe and idempotent.

## Workflow

1. Read `references/npm-oidc-release.md`.
2. Inspect the repository's current release model:
   - `package.json`, package manager files, workspace config, `.npmrc`, `.changeset/`;
   - `.github/workflows/`;
   - release docs such as `docs/release.md`;
   - release scripts under `scripts/`.
3. Decide which path applies:
   - **Create or repair `release.yml`**: configure GitHub Actions OIDC and call the existing build/test/publish scripts.
   - **Configure npm trusted publishing**: after the npm package exists, run `npm trust github ... --file release.yml --allow-publish`.
   - **Bootstrap a new package locally**: build, pack, inspect, then publish with the user's OTP.
   - **Normal release**: do not manually publish; use the repository's release workflow.
4. Verify before reporting:
   - run formatting or repository checks that are already available;
   - inspect generated npm archives before publishing;
   - after publish, verify `npm view <package>@<version>`;
   - for workflow edits, check the exact workflow filename used by npm trusted publishing.

## OTP handling

When the user says they will provide an OTP:

- Ask for it only when all pre-publish checks are complete and the next command is the real publish.
- Pass it directly as the publish command's OTP argument, for example `--otp <code>`.
- Do not put it in environment files, `.npmrc`, GitHub secrets, logs, PR text, commit messages, or notes.
- If the publish command supports redaction, use it. If it does not, avoid echoing the full command back to the user.

## Divebell-shaped repositories

For a repository that looks like Divebell, prefer its existing release scripts:

```bash
pnpm run release:npm:check
pnpm run release:npm:pack -- --output-dir /tmp/divebell-npm-packages
pnpm run publish:packages -- --output-dir /tmp/divebell-npm-packages --otp <code>
```

Use the local publish command only for bootstrap or recovery work that the user explicitly asks for. The normal release source of truth is `.github/workflows/release.yml`.

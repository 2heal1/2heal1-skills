#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repository = path.resolve(process.argv[2] ?? process.cwd());
const errors = [];
const warnings = [];

function filePath(name) {
  return path.join(repository, name);
}

function exists(name) {
  return fs.existsSync(filePath(name));
}

function read(name, required = true) {
  const target = filePath(name);
  if (!fs.existsSync(target)) {
    if (required) errors.push(`Missing ${name}`);
    return "";
  }
  return fs.readFileSync(target, "utf8");
}

function parseJson(name) {
  const text = read(name);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push(`Invalid JSON in ${name}: ${error.message}`);
    return null;
  }
}

function requirePattern(text, pattern, message) {
  if (!pattern.test(text)) errors.push(message);
}

function rejectPattern(text, pattern, message) {
  if (pattern.test(text)) errors.push(message);
}

function countPattern(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseVersion(value) {
  const match = String(value).match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function versionAtLeast(actual, minimum) {
  if (!actual) return false;
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

if (!fs.existsSync(repository) || !fs.statSync(repository).isDirectory()) {
  console.error(`Repository directory does not exist: ${repository}`);
  process.exit(2);
}

const packageJson = parseJson("package.json");
const ci = read(".github/workflows/ci.yml");
const release = read(".github/workflows/release.yml");
const changesetConfig = parseJson(".changeset/config.json");
const releaseGuide = read("docs/releasing.md");

let manager = null;
let managerVersion = null;
let publishAccess = null;

if (packageJson) {
  if (!packageJson.name) errors.push("package.json must define name");
  if (typeof packageJson.version !== "string" || !packageJson.version) {
    errors.push("package.json must define an explicit version");
  }

  const packageManager = packageJson.packageManager;
  if (typeof packageManager !== "string") {
    errors.push("package.json must pin packageManager to an exact version");
  } else if (/^pnpm@\d+\.\d+\.\d+$/.test(packageManager)) {
    manager = "pnpm";
    managerVersion = packageManager.slice("pnpm@".length);
  } else if (/^npm@\d+\.\d+\.\d+$/.test(packageManager)) {
    manager = "npm";
    managerVersion = packageManager.slice("npm@".length);
  } else {
    errors.push(
      "packageManager must be an exact pnpm@x.y.z or npm@x.y.z version",
    );
  }

  publishAccess = packageJson.publishConfig?.access;
  if (!["public", "restricted"].includes(publishAccess)) {
    errors.push('publishConfig.access must be "public" or "restricted"');
  }
  if (
    String(packageJson.publishConfig?.registry ?? "").replace(/\/$/, "") !==
    "https://registry.npmjs.org"
  ) {
    errors.push(
      'publishConfig.registry must be "https://registry.npmjs.org"',
    );
  }
  if (!packageJson.repository) {
    errors.push("package.json must define repository metadata");
  }

  for (const script of ["changeset", "version", "release"]) {
    if (!packageJson.scripts?.[script]) {
      errors.push(`package.json must define the ${script} script`);
    }
  }
}

const lockfiles = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
].filter(exists);

if (lockfiles.length !== 1) {
  errors.push(
    `Expected exactly one package-manager lockfile; found ${lockfiles.length}: ${
      lockfiles.join(", ") || "none"
    }`,
  );
}

if (manager === "pnpm") {
  if (!exists("pnpm-lock.yaml")) {
    errors.push("pnpm packageManager requires pnpm-lock.yaml");
  }
  rejectPattern(
    `${ci}\n${release}`,
    /\bnpm\s+ci\b/,
    "pnpm workflows must not run npm ci",
  );
  requirePattern(
    ci,
    /pnpm\/action-setup@/,
    "CI must set up the pinned pnpm tool",
  );
  requirePattern(
    release,
    /pnpm\/action-setup@/,
    "Release workflow must set up the pinned pnpm tool",
  );
  const pinnedPnpm = new RegExp(
    `\\bversion:\\s*["']?${escapeRegExp(managerVersion)}["']?`,
    "g",
  );
  if (countPattern(ci, pinnedPnpm) < 1) {
    errors.push(`CI must set up pnpm ${managerVersion}`);
  }
  if (countPattern(release, pinnedPnpm) < 2) {
    errors.push(
      `Stable and preview release jobs must set up pnpm ${managerVersion}`,
    );
  }
  requirePattern(
    ci,
    /pnpm\s+install\s+--frozen-lockfile/,
    "CI must install with pnpm --frozen-lockfile",
  );
  if (countPattern(release, /pnpm\s+install\s+--frozen-lockfile/g) < 2) {
    errors.push(
      "Both stable and preview release jobs must use pnpm --frozen-lockfile",
    );
  }
  requirePattern(
    release,
    /pnpm\s+install\s+--lockfile-only\s+--ignore-scripts/,
    "Preview path must update pnpm-lock.yaml after snapshot versioning",
  );
}

if (manager === "npm") {
  if (!exists("package-lock.json")) {
    errors.push("npm packageManager requires package-lock.json");
  }
  rejectPattern(
    `${ci}\n${release}`,
    /\bpnpm\s+(?:install|run|exec|pack)\b/,
    "npm workflows must not run pnpm commands",
  );
  requirePattern(ci, /\bnpm\s+ci\b/, "CI must install with npm ci");
  if (countPattern(release, /\bnpm\s+ci\b/g) < 2) {
    errors.push("Both stable and preview release jobs must run npm ci");
  }
  const pinnedNpm = new RegExp(
    `npm\\s+install\\s+(?:--global|-g)\\s+npm@${escapeRegExp(managerVersion)}`,
    "g",
  );
  if (countPattern(ci, pinnedNpm) < 1) {
    errors.push(`CI must set up npm ${managerVersion}`);
  }
  if (countPattern(release, pinnedNpm) < 2) {
    errors.push(
      `Stable and preview release jobs must set up npm ${managerVersion}`,
    );
  }
  if (!versionAtLeast(parseVersion(managerVersion), [11, 5, 1])) {
    errors.push("npm packageManager must be 11.5.1 or newer for OIDC publishing");
  }
  requirePattern(
    release,
    /npm\s+install\s+--package-lock-only\s+--ignore-scripts/,
    "Preview path must update package-lock.json after snapshot versioning",
  );
}

requirePattern(ci, /\bpull_request\s*:/, "CI must run on pull requests");
requirePattern(ci, /\bpush\s*:/, "CI must run on pushes");
requirePattern(ci, /-\s+main\b/, "CI push trigger must include main");
requirePattern(ci, /runs-on:\s*ubuntu-latest/, "CI must use ubuntu-latest");
requirePattern(
  ci,
  /\bpack\b[^\n]*--dry-run/,
  "CI must inspect package contents with a pack dry run",
);

requirePattern(
  release,
  /\bworkflow_dispatch\s*:/,
  "Release workflow must support manual preview dispatch",
);
requirePattern(
  release,
  /\bpush\s*:/,
  "Release workflow must run on pushes",
);
requirePattern(
  release,
  /-\s+main\b/,
  "Release workflow push trigger must include main",
);
if (countPattern(release, /runs-on:\s*ubuntu-latest/g) < 2) {
  errors.push("Stable and preview release jobs must use ubuntu-latest");
}
if (countPattern(release, /\bid-token:\s*write\b/g) < 2) {
  errors.push("Stable and preview release jobs must grant id-token: write");
}
if (
  countPattern(
    release,
    /registry-url:\s*["']?https:\/\/registry\.npmjs\.org\/?["']?/g,
  ) < 2
) {
  errors.push(
    "Stable and preview release jobs must set the npm registry URL",
  );
}
rejectPattern(
  release,
  /\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\b/,
  "Release workflow must not use a long-lived npm token",
);
requirePattern(
  release,
  /changesets\/action@v1/,
  "Stable path must use changesets/action@v1",
);
const changesetsActionStart = release.indexOf("changesets/action@v1");
if (changesetsActionStart >= 0) {
  const nextStep = release.indexOf("\n      - ", changesetsActionStart + 1);
  const actionStep = release.slice(
    changesetsActionStart,
    nextStep >= 0 ? nextStep : undefined,
  );
  rejectPattern(
    actionStep,
    /^\s+publish:\s*/m,
    "Keep npm publishing outside the Changesets action publish input",
  );
}
requirePattern(
  release,
  /hasChangesets\s*==\s*['"]false['"]/,
  "Stable publish must run after the release PR has consumed changesets",
);
requirePattern(
  release,
  /changeset\s+version\s+--snapshot\s+preview/,
  "Preview path must create a preview snapshot version",
);
requirePattern(
  release,
  /changeset\s+publish[^\n]*--tag\s+preview[^\n]*--no-git-tag/,
  "Preview path must publish the preview tag without a Git tag",
);

const nodeMatches = [
  ...release.matchAll(/node-version:\s*["']?(\d+\.\d+\.\d+)["']?/g),
];
if (
  nodeMatches.length < 2 ||
  nodeMatches.some(
    (match) => !versionAtLeast(parseVersion(match[1]), [22, 14, 0]),
  )
) {
  errors.push(
    "Stable and preview jobs must use Node.js 22.14.0 or newer",
  );
}

if (manager === "pnpm") {
  const npmVersions = [
    ...release.matchAll(
      /npm\s+install\s+(?:--global|-g)\s+npm@(\d+\.\d+\.\d+)/g,
    ),
  ];
  if (
    npmVersions.length < 2 ||
    npmVersions.some(
      (match) => !versionAtLeast(parseVersion(match[1]), [11, 5, 1]),
    )
  ) {
    errors.push(
      "Stable and preview jobs must install npm CLI 11.5.1 or newer for OIDC publishing",
    );
  }
}

if (changesetConfig) {
  if (changesetConfig.access !== publishAccess) {
    errors.push(
      ".changeset/config.json access must match publishConfig.access",
    );
  }
  if (changesetConfig.baseBranch !== "main") {
    errors.push('.changeset/config.json baseBranch must be "main"');
  }
}

const releaseGuideChecks = [
  ["changeset", /changeset/i],
  ["preview", /preview/i],
  ["release pull request", /release\s+(?:pull request|pr)/i],
];
for (const [label, pattern] of releaseGuideChecks) {
  if (!pattern.test(releaseGuide)) {
    warnings.push(`docs/releasing.md should explain ${label}`);
  }
}

if (errors.length > 0) {
  console.error(`Release setup validation failed for ${repository}\n`);
  for (const error of errors) console.error(`ERROR: ${error}`);
  for (const warning of warnings) console.error(`WARN: ${warning}`);
  process.exit(1);
}

console.log(`Release setup validation passed for ${repository}`);
if (packageJson) {
  console.log(`Package: ${packageJson.name}@${packageJson.version}`);
  console.log(`Package manager: ${packageJson.packageManager}`);
}
for (const warning of warnings) console.warn(`WARN: ${warning}`);

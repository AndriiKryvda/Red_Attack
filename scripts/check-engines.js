'use strict';

// Toolchain guard, run automatically by `npm run preinstall`.
//
// The root scripts drive the monorepo with `npm run build -w packages/shared`.
// npm 6 has no workspaces: it ignores `-w`, appends the leftover path to the
// script line, and so `build:shared` re-runs the root `build` script forever.
// `engines` + `engine-strict=true` in .npmrc is the first line of defence; this
// is the belt-and-braces version of it, so the failure is always a readable
// message instead of an endless loop.

const MIN_NODE = [18, 0, 0];
const MIN_NPM = [9, 0, 0];

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value || ''));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isAtLeast(version, minimum) {
  const parts = parseVersion(version);
  if (!parts) return false;
  for (let i = 0; i < minimum.length; i++) {
    if (parts[i] > minimum[i]) return true;
    if (parts[i] < minimum[i]) return false;
  }
  return true;
}

// npm exports the running version as a user agent string to lifecycle scripts,
// which is more honest than process.versions.npm (that is the *bundled* npm).
function detectNpmVersion() {
  const agent = process.env.npm_config_user_agent || '';
  const match = /^npm\/(\d+\.\d+\.\d+)/.exec(agent);
  if (match) return match[1];
  return process.versions.npm || '';
}

function check() {
  const node = process.versions.node;
  const npm = detectNpmVersion();
  const problems = [];
  const notes = [];

  if (!isAtLeast(node, MIN_NODE)) {
    problems.push(`Node ${node} is too old - need >= ${MIN_NODE.join('.')}`);
  }
  if (!npm) {
    notes.push('npm version could not be detected, so it was not checked');
  } else if (!isAtLeast(npm, MIN_NPM)) {
    problems.push(`npm ${npm} is too old - need >= ${MIN_NPM.join('.')}`);
  }

  return { problems, notes };
}

function main() {
  const { problems, notes } = check();
  for (const note of notes) console.warn(`check-engines: ${note}`);
  if (problems.length === 0) return;

  console.error('\n*** Red Attack needs a newer Node / npm ***');
  for (const problem of problems) console.error(` - ${problem}`);
  console.error(
    '\nThe workspace scripts use "npm run -w <package>", which npm 6 and older\n' +
    'silently ignore — that makes "npm run build" recurse forever.\n' +
    'Install Node 18 or newer (nvm install && nvm use) and run npm install again.\n'
  );
  process.exit(1);
}

if (require.main === module) main();

module.exports = { check, isAtLeast, parseVersion };

'use strict';

// Toolchain guard, run automatically by `npm run preinstall`.
//
// The root scripts drive the monorepo with `npm run build -w packages/shared`.
// npm 6 has no workspaces: it ignores `-w`, appends the leftover path to the
// script line, and so `build:shared` re-runs the root `build` script forever.
// `engines` + `engine-strict=true` in .npmrc is the first line of defence; this
// is the belt-and-braces version of it, so the failure is always a readable
// message instead of an endless loop.

const MIN_NODE = [22, 0, 0];
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

  if (process.env.SKIP_ENGINES_CHECK) {
    console.warn(
      '\ncheck-engines: version gate skipped because SKIP_ENGINES_CHECK is set.\n' +
      'Expect the build to fail anyway: Vite 5 needs Node 18+ and\n' +
      '@colyseus/core 0.18 needs Node 22.\n'
    );
    return;
  }

  console.error('\n*** Red Attack needs a newer Node / npm ***');
  for (const problem of problems) console.error(` - ${problem}`);
  console.error(
    '\nThis project needs Node 22: Vite 5 requires Node 18+ and @colyseus/core 0.18\n' +
    'requires Node 22. Install it, then run npm install again:\n' +
    '  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -\n' +
    '  sudo apt-get install -y nodejs\n' +
    'No sudo? Unpack the linux-arm64 / linux-x64 tarball from nodejs.org into\n' +
    '~/.local and put its bin/ first on PATH.\n' +
    'To install anyway at your own risk: SKIP_ENGINES_CHECK=1 npm install\n'
  );
  process.exit(1);
}

if (require.main === module) main();

module.exports = { check, isAtLeast, parseVersion };

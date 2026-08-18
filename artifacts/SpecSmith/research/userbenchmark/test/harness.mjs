// Minimal zero-dependency test harness. No devDependency is added to the
// project for research-only tooling.

const suites = [];
let current = null;

export function describe(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

export function it(name, fn) {
  if (!current) throw new Error('it() called outside describe()');
  current.tests.push({ name, fn });
}

function fmt(v) {
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v);
  return s == null ? String(v) : s.length > 200 ? s.slice(0, 200) + '…' : s;
}

export const assert = {
  equal(actual, expected, msg) {
    if (actual !== expected) throw new Error(`${msg ? msg + ': ' : ''}expected ${fmt(expected)}, got ${fmt(actual)}`);
  },
  deepEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${msg ? msg + ': ' : ''}expected ${fmt(expected)}, got ${fmt(actual)}`);
  },
  ok(v, msg) {
    if (!v) throw new Error(`${msg ? msg + ': ' : ''}expected truthy, got ${fmt(v)}`);
  },
  notOk(v, msg) {
    if (v) throw new Error(`${msg ? msg + ': ' : ''}expected falsy, got ${fmt(v)}`);
  },
  includes(haystack, needle, msg) {
    if (!String(haystack).includes(needle)) throw new Error(`${msg ? msg + ': ' : ''}expected ${fmt(haystack)} to include ${fmt(needle)}`);
  },
};

export async function run() {
  let passed = 0;
  const failures = [];
  for (const s of suites) {
    console.log(`\n${s.name}`);
    for (const t of s.tests) {
      try {
        await t.fn();
        passed++;
        console.log(`  ✓ ${t.name}`);
      } catch (e) {
        failures.push({ suite: s.name, test: t.name, error: e });
        console.log(`  ✗ ${t.name}\n      ${e.message}`);
      }
    }
  }
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${passed} passed, ${failures.length} failed, ${passed + failures.length} total`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ${f.suite} › ${f.test}\n    ${f.error.message}`);
    process.exitCode = 1;
  }
  return failures.length === 0;
}

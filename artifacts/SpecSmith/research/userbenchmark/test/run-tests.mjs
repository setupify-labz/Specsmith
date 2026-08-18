// Test entry point:  node research/userbenchmark/test/run-tests.mjs
//
// RESEARCH-ONLY. Tests read the saved page sources in ../pages/ and
// hand-written fixtures in ./fixtures/. No network access.

import { run } from './harness.mjs';

import './efps.test.mjs';
import './game-page.test.mjs';
import './dedupe.test.mjs';
import './validate.test.mjs';
import './capture.test.mjs';
import './corpus.test.mjs';
import './canonical.test.mjs';

await run();

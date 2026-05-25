import test from "node:test";
import assert from "node:assert/strict";

import { getChromiumLaunchOptions } from "../lib/browser-options.js";

test("does not force Chromium into single process mode for parallel analyses", () => {
  const options = getChromiumLaunchOptions({ headless: true });

  assert.equal(options.headless, true);
  assert.equal(options.args.includes("--single-process"), false);
});

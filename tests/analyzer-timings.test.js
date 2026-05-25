import test from "node:test";
import assert from "node:assert/strict";

import { ANALYZER_TIMINGS } from "../lib/analyzer-timings.js";

test("uses bounded waits so slow pages cannot stall the analyzer for too long", () => {
  assert.equal(ANALYZER_TIMINGS.doctorListMaxWaitMs <= 45_000, true);
  assert.equal(ANALYZER_TIMINGS.loadMoreMaxWaitMs <= 6_000, true);
  assert.equal(ANALYZER_TIMINGS.quietPassesToStop <= 2, true);
  assert.equal(ANALYZER_TIMINGS.slotSwitchWaitMs <= 320, true);
});

import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

test("server slot counter has a text fallback when rendered time buttons are not visibly measurable", async () => {
  const serverJs = await readFile(new URL("../server.js", import.meta.url), "utf8");

  assert.match(serverJs, /function extractTimesFromText/);
  assert.match(serverJs, /function collectSlotTimes/);
  assert.doesNotMatch(
    serverJs,
    /querySelectorAll\("\.n-time-slot,\s*\.time-slots-list__time-slot"\)\)\s*\.filter\(visible\)/,
    "Time slots must not depend only on strict visible() geometry checks."
  );
});

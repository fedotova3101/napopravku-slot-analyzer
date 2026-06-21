import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

test("server slot counter has a text fallback when rendered time buttons are not visibly measurable", async () => {
  const serverJs = await readFile(new URL("../server.js", import.meta.url), "utf8");

  assert.match(serverJs, /function extractTimesFromText/);
  assert.match(serverJs, /function collectSlotTimes/);
  assert.match(serverJs, /function firstDateFromCardText/);
  assert.match(serverJs, /function inferSlotsFromCardText/);
  assert.match(serverJs, /if \(!button\) return textFallback\("target-date-not-found"\);/);
  assert.match(serverJs, /if \(disabled\(button\)\) return textFallback\("target-date-disabled"\);/);
  assert.doesNotMatch(
    serverJs,
    /querySelectorAll\("\.n-time-slot,\s*\.time-slots-list__time-slot"\)\)\s*\.filter\(visible\)/,
    "Time slots must not depend only on strict visible() geometry checks."
  );
});

test("server counts target dates in clinic timezone instead of hardcoded Moscow", async () => {
  const serverJs = await readFile(new URL("../server.js", import.meta.url), "utf8");

  assert.match(serverJs, /resolveNapopravkuTimezone/);
  assert.match(serverJs, /dateLabelForOffset/);
  assert.match(serverJs, /clinicTimeZone\s*=\s*resolveNapopravkuTimezone\(pageUrl\)/);
  assert.match(serverJs, /dateLabelForOffset\(clinicTimeZone,\s*0\)/);
  assert.match(serverJs, /dateLabelForOffset\(clinicTimeZone,\s*1\)/);
  assert.doesNotMatch(serverJs, /timezoneId:\s*"Europe\/Moscow"/);
});

test("server scrolls each doctor card into view before reading slots", async () => {
  const serverJs = await readFile(new URL("../server.js", import.meta.url), "utf8");

  assert.match(serverJs, /card\.scrollIntoView\(\{\s*block:\s*"center"/);
  assert.match(serverJs, /waitForSlotRender/);
  assert.match(serverJs, /textFallback\("target-date-not-found"\)/);
  assert.match(serverJs, /slotDebug/);
});

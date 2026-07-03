import test from "node:test";
import assert from "node:assert/strict";

import { parseSlotDateText, slotDatesEqual, summarizeSlotDiagnostics } from "../lib/slot-date.js";

test("matches every day of a month with or without a leading zero", () => {
  for (let day = 1; day <= 31; day += 1) {
    const padded = `${String(day).padStart(2, "0")}.07`;
    const unpadded = `${day}.07`;
    assert.equal(slotDatesEqual(padded, unpadded), true, `${padded} must equal ${unpadded}`);
  }
});

test("extracts a date from a NaPopravku calendar label", () => {
  assert.deepEqual(parseSlotDateText("  пт​\n3.07  "), { day: 3, month: 7 });
  assert.deepEqual(parseSlotDateText("пн 29.02"), { day: 29, month: 2 });
});

test("does not confuse different days or months", () => {
  assert.equal(slotDatesEqual("3.07", "4.07"), false);
  assert.equal(slotDatesEqual("3.07", "3.08"), false);
  assert.equal(slotDatesEqual("31.12", "1.01"), false);
});

test("rejects impossible and missing dates", () => {
  for (const value of ["", "32.07", "0.07", "3.13", "завтра"] ) {
    assert.equal(parseSlotDateText(value), null, value);
  }
});

test("detects a schedule format mismatch instead of accepting a false zero", () => {
  const rows = [{
    today: { count: 0, slotDebug: { reason: "target-date-not-found", visibleTimesBefore: ["15:45"] } },
    tomorrow: { count: 0, slotDebug: { reason: "target-date-not-found", visibleTimesBefore: ["13:00"] } }
  }];

  assert.deepEqual(summarizeSlotDiagnostics(rows), {
    reasonCounts: { "target-date-not-found": 2 },
    checks: 2,
    checksWithRenderedTimes: 2,
    scheduleFormatMismatch: true
  });
});

test("does not flag a legitimate day without slots", () => {
  const rows = [{
    today: { count: 0, slotDebug: { reason: "target-date-disabled", visibleTimesBefore: [] } },
    tomorrow: { count: 4, slotDebug: { reason: "slot-times-found", visibleTimesBefore: [] } }
  }];

  assert.equal(summarizeSlotDiagnostics(rows).scheduleFormatMismatch, false);
});

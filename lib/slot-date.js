export function parseSlotDateText(value) {
  const match = String(value || "").match(/(?:^|\D)(\d{1,2})\.(\d{1,2})(?:\D|$)/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { day, month };
}

export function slotDatesEqual(left, right) {
  const leftDate = parseSlotDateText(left);
  const rightDate = parseSlotDateText(right);
  return Boolean(
    leftDate &&
    rightDate &&
    leftDate.day === rightDate.day &&
    leftDate.month === rightDate.month
  );
}

export function summarizeSlotDiagnostics(rows) {
  const checks = (Array.isArray(rows) ? rows : [])
    .flatMap(row => [row?.today, row?.tomorrow])
    .filter(Boolean);
  const reasonCounts = {};
  let checksWithRenderedTimes = 0;

  for (const check of checks) {
    const reason = check?.slotDebug?.reason || "unknown";
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    if ((check?.slotDebug?.visibleTimesBefore || []).length > 0) checksWithRenderedTimes += 1;
  }

  const unrecognizedChecks = reasonCounts["target-date-not-found"] || 0;
  return {
    reasonCounts,
    checks: checks.length,
    checksWithRenderedTimes,
    scheduleFormatMismatch: checks.length > 0 && checksWithRenderedTimes > 0 && unrecognizedChecks === checks.length
  };
}

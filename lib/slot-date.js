export function parseSlotDateText(value) {
  const text = String(value || "").toLowerCase();
  const numericMatch = text.match(/(?:^|\D)(\d{1,2})\.(\d{1,2})(?:\D|$)/);
  const monthNames = {
    января: 1,
    январь: 1,
    февраля: 2,
    февраль: 2,
    марта: 3,
    март: 3,
    апреля: 4,
    апрель: 4,
    мая: 5,
    май: 5,
    июня: 6,
    июнь: 6,
    июля: 7,
    июль: 7,
    августа: 8,
    август: 8,
    сентября: 9,
    сентябрь: 9,
    октября: 10,
    октябрь: 10,
    ноября: 11,
    ноябрь: 11,
    декабря: 12,
    декабрь: 12
  };
  const namedMatch = numericMatch ? null : text.match(/(?:^|\D)(\d{1,2})\s+(января|январь|февраля|февраль|марта|март|апреля|апрель|мая|май|июня|июнь|июля|июль|августа|август|сентября|сентябрь|октября|октябрь|ноября|ноябрь|декабря|декабрь)(?:\D|$)/i);
  const match = numericMatch || namedMatch;
  if (!match) return null;

  const day = Number(match[1]);
  const month = numericMatch ? Number(match[2]) : monthNames[match[2].toLowerCase()];
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

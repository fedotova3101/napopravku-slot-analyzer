import test from "node:test";
import assert from "node:assert/strict";

import { dateLabelForOffset, resolveNapopravkuTimezone } from "../lib/city-timezones.js";

test("resolves Napopravku city timezone from URL slug", () => {
  assert.equal(
    resolveNapopravkuTimezone("https://napopravku.ru/vladivostok/clinics/doverie-na-kirova/vrachi/#doctors"),
    "Asia/Vladivostok"
  );
  assert.equal(
    resolveNapopravkuTimezone("https://spb.napopravku.ru/clinics/psyonclinic--klinika-professionalnoy-psihoterapii/vrachi/#doctors"),
    "Europe/Moscow"
  );
  assert.equal(
    resolveNapopravkuTimezone("https://napopravku.ru/novosibirsk/doctors/stomatolog-terapevt/"),
    "Asia/Novosibirsk"
  );
});

test("falls back to Moscow timezone for unknown city slugs", () => {
  assert.equal(
    resolveNapopravkuTimezone("https://napopravku.ru/unknown-city/clinics/example/vrachi/#doctors"),
    "Europe/Moscow"
  );
});

test("formats today and tomorrow in clinic local timezone", () => {
  const nearMoscowMidnight = new Date("2026-06-19T20:30:00.000Z");

  assert.equal(dateLabelForOffset("Europe/Moscow", 0, nearMoscowMidnight), "19.06");
  assert.equal(dateLabelForOffset("Europe/Moscow", 1, nearMoscowMidnight), "20.06");
  assert.equal(dateLabelForOffset("Asia/Vladivostok", 0, nearMoscowMidnight), "20.06");
  assert.equal(dateLabelForOffset("Asia/Vladivostok", 1, nearMoscowMidnight), "21.06");
});

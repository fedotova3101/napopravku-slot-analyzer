import test from "node:test";
import assert from "node:assert/strict";

import { normalizeNapopravkuUrl } from "../lib/url-normalizer.js";

test("accepts clinic, doctors, and specialty Napopravku URLs", () => {
  assert.equal(
    normalizeNapopravkuUrl("https://napopravku.ru/kirov/clinics/sovermed/"),
    "https://napopravku.ru/kirov/clinics/sovermed/vrachi/#doctors"
  );
  assert.equal(
    normalizeNapopravkuUrl("https://napopravku.ru/kirov/clinics/sovermed/vrachi/#doctors"),
    "https://napopravku.ru/kirov/clinics/sovermed/vrachi/#doctors"
  );
  assert.equal(
    normalizeNapopravkuUrl("https://napopravku.ru/kirov/doctors/stomatolog-terapevt/"),
    "https://napopravku.ru/kirov/doctors/stomatolog-terapevt/"
  );
});

test("rejects non-Napopravku and unsafe URLs", () => {
  assert.equal(normalizeNapopravkuUrl("https://example.com"), null);
  assert.equal(normalizeNapopravkuUrl("javascript:alert(1)"), null);
});

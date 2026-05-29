import test from "node:test";
import assert from "node:assert/strict";
import { buildXlsxBuffer } from "../lib/xlsx-export.js";

function readZipFileNames(buffer) {
  const names = [];
  let offset = 0;
  while (offset < buffer.length - 4) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + fileNameLength).toString("utf8");
    names.push(name);
    offset = nameStart + fileNameLength + extraLength + compressedSize;
  }
  return names;
}

test("xlsx export builds a real Excel workbook instead of renamed XML", () => {
  const buffer = buildXlsxBuffer([
    {
      name: "Иванова Анна Петровна",
      specialties: "гинеколог",
      clinic: "Клиника",
      address: "ул. Тестовая, 1",
      day: "Сегодня, 29.05",
      count: 5,
      times: "09:00, 10:00"
    }
  ]);

  assert.equal(buffer.subarray(0, 2).toString("utf8"), "PK");
  assert.deepEqual(readZipFileNames(buffer), [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml"
  ]);

  const text = buffer.toString("utf8");
  assert.match(text, /Иванова Анна Петровна/);
  assert.match(text, /Время окон/);
});

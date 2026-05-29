import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

async function readPublicFile(name) {
  return readFile(new URL(`../public/${name}`, import.meta.url), "utf8");
}

test("public UI keeps proposal before doctor results", async () => {
  const html = await readPublicFile("index.html");

  const proposalIndex = html.indexOf('id="proposalBlock"');
  const resultsIndex = html.indexOf('id="results"');

  assert.ok(proposalIndex > -1, "The editable proposal block must exist.");
  assert.ok(resultsIndex > -1, "The doctor results block must exist.");
  assert.ok(
    proposalIndex < resultsIndex,
    "The proposal should appear before doctor result lists so colleagues can copy it first."
  );
});

test("progress panel shows only quiet metrics instead of technical stages", async () => {
  const html = await readPublicFile("index.html");
  const appJs = await readPublicFile("app.js");

  assert.doesNotMatch(html, /progressStage|progressDetail/);
  assert.doesNotMatch(appJs, /progressStage|progressDetail/);
  assert.match(html, /id="progressPercent"/);
  assert.match(html, /id="progressLoaded"/);
  assert.match(html, /id="progressAnalyzed"/);
  assert.match(html, /id="progressQueue"/);
});

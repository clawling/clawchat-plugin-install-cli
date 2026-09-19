import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const INTRO = path.join(ROOT, "livewares/openclaw/liveware-sample/intro.i18n.json");
const LANGUAGES = ["en", "es", "ja", "ko", "zh", "zh_Hant"];

test("intro.i18n.json carries exactly the supported languages, all non-empty", () => {
  const data = JSON.parse(fs.readFileSync(INTRO, "utf8"));
  assert.equal(data.schema, 1);
  assert.deepEqual(Object.keys(data.intro).sort(), [...LANGUAGES].sort());
  for (const lang of LANGUAGES) {
    assert.equal(typeof data.intro[lang], "string", `${lang} must be a string`);
    assert.ok(data.intro[lang].trim().length > 0, `${lang} must be non-empty`);
  }
});

test("intro.i18n.json is listed for both targets in the generated manifest", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "livewares/manifest.json"), "utf8"));
  for (const target of ["openclaw", "hermes"]) {
    const files = manifest.livewares[target]["liveware-sample"].files.map((f) => f.path);
    assert.ok(
      files.includes("openclaw/liveware-sample/intro.i18n.json"),
      `${target} must ship intro.i18n.json`,
    );
  }
});

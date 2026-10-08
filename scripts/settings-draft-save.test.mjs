import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/app/dashboard/settings/page.tsx", import.meta.url), "utf8");

test("ordinary settings stay as page drafts until the bottom save action", () => {
  const draftHelpers = source.slice(
    source.indexOf("const updateDictionaryDisplayMode"),
    source.indexOf("const saveAiCredential"),
  );

  assert.doesNotMatch(draftHelpers, /fetch\(/);
  assert.doesNotMatch(draftHelpers, /writeDictionary/);
  assert.doesNotMatch(source, /scheduleReadingPreferencesSave|persistReadingPreferences|persistAiExplanationLanguage|persistDictionaryTranslationMode/);
  assert.doesNotMatch(source, /onClick=\{\(\) => setLocale\(/);
  assert.match(source, /onClick=\{\(\) => setInterfaceLocale\("zh-CN"\)\}/);
  assert.match(source, /onClick=\{\(\) => setAiExplanationLanguage\("en"\)\}/);
});

test("save action persists every ordinary account and browser preference", () => {
  const saveAction = source.slice(
    source.indexOf("const handleSave"),
    source.indexOf("const updatePreset"),
  );

  assert.match(saveAction, /fetch\("\/api\/user"/);
  assert.match(saveAction, /fetch\("\/api\/user\/reading-preferences"/);
  assert.match(saveAction, /fetch\("\/api\/user\/ai-preferences"/);
  assert.match(saveAction, /writeDictionaryDisplayMode\(dictionaryDisplayMode\)/);
  assert.match(saveAction, /writeDictionaryCardOverflowMode\(dictionaryCardOverflowMode\)/);
  assert.match(saveAction, /setLocale\(interfaceLocale\)/);
});

test("saved confirmation is rendered between sign-out and save controls", () => {
  const footer = source.slice(source.lastIndexOf('<div className="mt-7 grid'));
  const signOut = footer.indexOf("handleLogout");
  const confirmation = footer.indexOf('role="status"');
  const save = footer.indexOf("handleSave");

  assert.ok(signOut >= 0 && confirmation > signOut && save > confirmation);
  assert.match(footer, /保存成功/);
  assert.match(footer, /未保存的更改在离开页面后不会保留/);
  assert.match(footer, /sm:grid-cols-\[1fr_auto_1fr\]/);
});

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const root = process.cwd();
const archivePath = path.join(root, "vendor", "dictionaries", "english-wordnet-2025-json.zip");
const outputDir = path.join(root, "vendor", "dictionaries", "generated");
const expectedSha256 = "7D749F6E2C39E6970E4997839DCF6E42FD281F3C2FAE0171D2192BAE8CFA4B51";
const dataset = {
  provider: "Open English WordNet",
  version: "2025 Core",
  sourceUrl: "https://en-word.net/",
  licenseName: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  archiveSha256: expectedSha256,
};

const archive = await readFile(archivePath);
const actualSha256 = createHash("sha256").update(archive).digest("hex").toUpperCase();
if (actualSha256 !== expectedSha256) {
  throw new Error(`Open English WordNet archive checksum mismatch: ${actualSha256}`);
}

const zip = await JSZip.loadAsync(archive);
const synsets = new Map();
const synsetNames = Object.keys(zip.files).filter((name) => !name.startsWith("entries-") && name !== "frames.json" && name.endsWith(".json")).sort();
for (const name of synsetNames) {
  const records = JSON.parse(await zip.file(name).async("string"));
  for (const [id, record] of Object.entries(records)) {
    synsets.set(id, {
      partOfSpeech: record.partOfSpeech,
      definitions: Array.isArray(record.definition) ? record.definition : [],
      examples: Array.isArray(record.example) ? record.example : [],
    });
  }
}

const partOfSpeechName = (value) => ({ n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb" })[value] || null;
const formIndexes = Object.fromEntries(["0", ..."abcdefghijklmnopqrstuvwxyz"].map((letter) => [letter, {}]));
const formShardName = (word) => /^[a-z]/.test(word[0] || "") ? word[0] : "0";
const isConsonant = (value) => /^[b-df-hj-np-tv-z]$/.test(value);
const isCvc = (lemma) => lemma.length >= 3
  && isConsonant(lemma.at(-1))
  && /^[aeiou]$/.test(lemma.at(-2) || "")
  && isConsonant(lemma.at(-3))
  && !/[wxy]$/.test(lemma);

const regularForms = (lemma, partOfSpeech) => {
  const forms = [];
  const add = (word, relation) => { if (word && word !== lemma) forms.push({ word, relation }); };
  if (partOfSpeech === "noun") {
    if (/[^aeiou]y$/.test(lemma)) add(`${lemma.slice(0, -1)}ies`, "plural");
    else if (/(?:s|x|z|ch|sh)$/.test(lemma)) add(`${lemma}es`, "plural");
    else add(`${lemma}s`, "plural");
    if (/f$/.test(lemma)) add(`${lemma.slice(0, -1)}ves`, "plural");
    if (/fe$/.test(lemma)) add(`${lemma.slice(0, -2)}ves`, "plural");
  }
  if (partOfSpeech === "verb") {
    if (/[^aeiou]y$/.test(lemma)) add(`${lemma.slice(0, -1)}ies`, "thirdPersonSingular");
    else if (/(?:s|x|z|ch|sh|o)$/.test(lemma)) add(`${lemma}es`, "thirdPersonSingular");
    else add(`${lemma}s`, "thirdPersonSingular");

    if (/[^aeiou]y$/.test(lemma)) add(`${lemma.slice(0, -1)}ied`, "past");
    else if (/e$/.test(lemma)) add(`${lemma}d`, "past");
    else {
      add(`${lemma}ed`, "past");
      if (isCvc(lemma)) add(`${lemma}${lemma.at(-1)}ed`, "past");
    }

    if (/ie$/.test(lemma)) add(`${lemma.slice(0, -2)}ying`, "presentParticiple");
    else if (/e$/.test(lemma) && !/(?:ee|ye|oe)$/.test(lemma)) add(`${lemma.slice(0, -1)}ing`, "presentParticiple");
    else {
      add(`${lemma}ing`, "presentParticiple");
      if (isCvc(lemma)) add(`${lemma}${lemma.at(-1)}ing`, "presentParticiple");
    }
  }
  if (partOfSpeech === "adjective") {
    if (/[^aeiou]y$/.test(lemma)) {
      add(`${lemma.slice(0, -1)}ier`, "comparative");
      add(`${lemma.slice(0, -1)}iest`, "superlative");
    } else if (/e$/.test(lemma)) {
      add(`${lemma}r`, "comparative");
      add(`${lemma}st`, "superlative");
    } else {
      add(`${lemma}er`, "comparative");
      add(`${lemma}est`, "superlative");
      if (isCvc(lemma)) {
        add(`${lemma}${lemma.at(-1)}er`, "comparative");
        add(`${lemma}${lemma.at(-1)}est`, "superlative");
      }
    }
  }
  return forms;
};

const inferExplicitRelation = (lemma, form, partOfSpeech, generated) => {
  const irregularRelation = {
    went: "past",
    ran: "past",
    gone: "pastParticiple",
    been: "pastParticiple",
    done: "pastParticiple",
    seen: "pastParticiple",
    written: "pastParticiple",
    spoken: "pastParticiple",
  }[form];
  if (partOfSpeech === "verb" && irregularRelation) return irregularRelation;
  const regular = generated.find((item) => item.word === form)?.relation;
  if (regular) return regular;
  if (partOfSpeech === "adjective") {
    if (form === "better" || /er$/.test(form)) return "comparative";
    if (form === "best" || /est$/.test(form)) return "superlative";
  }
  if (partOfSpeech === "verb") {
    if (/ing$/.test(form)) return "presentParticiple";
    if (/(?:en|wn)$/.test(form)) return "pastParticiple";
  }
  if (partOfSpeech === "noun") return "plural";
  return "inflected";
};

const addFormCandidate = (form, candidate) => {
  const normalized = typeof form === "string" ? form.toLowerCase().replaceAll("_", " ").trim() : "";
  if (!normalized || normalized === candidate.lemma || normalized.includes(" ")) return;
  const shard = formIndexes[formShardName(normalized)];
  const values = shard[normalized] || [];
  const existing = values.find((item) => item.lemma === candidate.lemma && item.partOfSpeech === candidate.partOfSpeech);
  if (existing) {
    if (candidate.explicit) Object.assign(existing, candidate);
    return;
  }
  values.push(candidate);
  shard[normalized] = values;
};

const entryNames = Object.keys(zip.files).filter((name) => name.startsWith("entries-") && name.endsWith(".json")).sort();
await mkdir(outputDir, { recursive: true });

for (const name of entryNames) {
  const entries = JSON.parse(await zip.file(name).async("string"));
  const output = {};
  for (const lemma of Object.keys(entries).sort((a, b) => a.localeCompare(b, "en"))) {
    const normalizedLemma = lemma.toLowerCase().replaceAll("_", " ");
    const definitions = [];
    const seen = new Set();
    for (const [partOfSpeechCode, entry] of Object.entries(entries[lemma])) {
      const partOfSpeech = partOfSpeechName(partOfSpeechCode);
      const generated = regularForms(normalizedLemma, partOfSpeech);
      for (const form of generated) addFormCandidate(form.word, { lemma: normalizedLemma, relation: form.relation, partOfSpeech, explicit: false });
      for (const form of Array.isArray(entry.form) ? entry.form : []) {
        addFormCandidate(form, { lemma: normalizedLemma, relation: inferExplicitRelation(normalizedLemma, String(form).toLowerCase(), partOfSpeech, generated), partOfSpeech, explicit: true });
      }
      for (const sense of entry.sense || []) {
        const synset = synsets.get(sense.synset);
        if (!synset) continue;
        for (const definition of synset.definitions) {
          if (typeof definition !== "string" || !definition.trim()) continue;
          const key = `${synset.partOfSpeech}|${definition.trim().toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          definitions.push({
            partOfSpeech: partOfSpeechName(synset.partOfSpeech),
            definition: definition.trim(),
            example: typeof synset.examples[0] === "string" ? synset.examples[0] : null,
          });
        }
      }
    }
    if (definitions.length) output[normalizedLemma] = definitions;
  }
  await writeFile(path.join(outputDir, name), `${JSON.stringify(output)}\n`, "utf8");
}

for (const shardName of Object.keys(formIndexes).sort()) {
  const output = formIndexes[shardName];
  for (const values of Object.values(output)) values.sort((a, b) => Number(b.explicit) - Number(a.explicit) || a.lemma.localeCompare(b.lemma, "en") || String(a.partOfSpeech).localeCompare(String(b.partOfSpeech), "en"));
  await writeFile(path.join(outputDir, `forms-${shardName}.json`), `${JSON.stringify(output)}\n`, "utf8");
}

await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify({ ...dataset, entryShards: entryNames.length, formShards: Object.keys(formIndexes).length, generatedAt: "deterministic-from-pinned-archive" }, null, 2)}\n`, "utf8");
console.log(`Prepared Open English WordNet ${dataset.version}: ${entryNames.length} entry shards, ${Object.keys(formIndexes).length} form shards, ${synsets.size} synsets.`);

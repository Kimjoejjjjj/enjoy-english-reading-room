"""Read-only by default. --apply is reserved for explicit user authorization.
Removes only the exact synthetic records accidentally created by two test runs.
"""
import argparse, hashlib, json, sqlite3
from pathlib import Path
from datetime import datetime

EXPECTED = {
    "cmup5wr080000129q6rwtc4y6": "fixture-30a6ed77-cb27-4947-aee1-6b2eb6e0e032@example.invalid",
    "cmup5wr0q0001129q75g4gtkq": "fixture-35aaed06-76cd-4698-a2ed-cab50a3d16df@example.invalid",
    "cmup68cnd0000ps3p653xl5mk": "fixture-92fbe501-ae95-4c19-9a8e-fc58993abe50@example.invalid",
    "cmup68cnm0001ps3pi86ebsfy": "fixture-c8e63d33-04ce-4dc8-8762-9785088f808b@example.invalid",
}
ENTRIES = {"cmup5wr6a000x129qe9mk30ni": "calm garden", "cmup5wr5w000v129qmqgsv6bg": "quiet", "cmup5wr7u001c129qtbk1338y": "quiet room"}
parser = argparse.ArgumentParser()
parser.add_argument("--apply", action="store_true")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
db = root / "prisma/dev.db"
assert db.is_file() and (root / "package.json").is_file()
c = sqlite3.connect(db.as_uri() + ("?mode=rw" if args.apply else "?mode=ro"), uri=True)
c.execute("PRAGMA foreign_keys=ON")
marks = ",".join("?" for _ in EXPECTED)

def validate():
    for uid, email in EXPECTED.items():
        assert c.execute("SELECT email FROM users WHERE id=?", (uid,)).fetchone() == (email,), "Synthetic account binding changed"
    assert c.execute(f"SELECT COUNT(*) FROM Content WHERE userId IN ({marks})", tuple(EXPECTED)).fetchone()[0] == 15, "Synthetic inventory changed"
    for eid, lemma in ENTRIES.items():
        assert c.execute("SELECT lemma FROM VocabularyEntry WHERE id=?", (eid,)).fetchone() == (lemma,), "Synthetic entry binding changed"
        assert c.execute(f"SELECT COUNT(*) FROM UserVocabulary WHERE entryId=? AND userId NOT IN ({marks})", (eid, *EXPECTED)).fetchone()[0] == 0, "Entry is now referenced by another account"
    for table in ["Highlight", "LearningEvent", "SectionProgress", "ReadingProgress", "ReadingSession", "ReadingTimeDelta"]:
        assert c.execute(f'SELECT COUNT(*) FROM "{table}" WHERE userId IN ({marks}) AND contentId NOT IN (SELECT id FROM Content WHERE userId IN ({marks}))', (*EXPECTED, *EXPECTED)).fetchone()[0] == 0, "Synthetic record now references another account's book"
        assert c.execute(f'SELECT COUNT(*) FROM "{table}" WHERE userId NOT IN ({marks}) AND contentId IN (SELECT id FROM Content WHERE userId IN ({marks}))', (*EXPECTED, *EXPECTED)).fetchone()[0] == 0, "Another account now references a synthetic book"

validate()
print(json.dumps({"mode": "apply" if args.apply else "read-only", "accounts": EXPECTED, "books": 15, "new_dictionary_entries": ENTRIES}, ensure_ascii=False, indent=2))
if args.apply:
    backup_dir = root.parent / "backups"
    backup_dir.mkdir(exist_ok=True)
    backup = backup_dir / ("before-synthetic-cleanup-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".db")
    with sqlite3.connect(backup) as target:
        c.backup(target)
    with sqlite3.connect(backup.as_uri() + "?mode=ro", uri=True) as saved:
        assert saved.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "Backup integrity failed"
        assert saved.execute("PRAGMA foreign_key_check").fetchall() == [], "Backup has foreign-key violations"
    c.execute("BEGIN IMMEDIATE")
    try:
        validate()
        tables = [row[0] for row in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        before = {table: c.execute('SELECT * FROM "' + table + '"').fetchall() for table in tables}
        columns = {table: [row[1] for row in c.execute('PRAGMA table_info("' + table + '")')] for table in tables}
        removed = {table: set() for table in tables}
        removed["users"] = {row for row in before["users"] if row[columns["users"].index("id")] in EXPECTED}
        removed["VocabularyEntry"] = {row for row in before["VocabularyEntry"] if row[columns["VocabularyEntry"].index("id")] in ENTRIES}
        foreign_keys = {}
        for table in tables:
            groups = {}
            for fk in c.execute('PRAGMA foreign_key_list("' + table + '")'):
                groups.setdefault(fk[0], []).append(fk)
            foreign_keys[table] = [sorted(group, key=lambda fk: fk[1]) for group in groups.values()]
        changed = True
        while changed:
            changed = False
            for table in tables:
                for group in foreign_keys[table]:
                    parent, action = group[0][2], group[0][6]
                    if action != "CASCADE" or parent not in removed:
                        continue
                    assert all(fk[2] == parent and fk[6] == action for fk in group), "Inconsistent foreign key"
                    child_indices = [columns[table].index(fk[3]) for fk in group]
                    parent_indices = [columns[parent].index(fk[4] or "id") for fk in group]
                    parent_values = {tuple(row[index] for index in parent_indices) for row in removed[parent]}
                    matches = set()
                    for row in before[table]:
                        values = tuple(row[index] for index in child_indices)
                        if all(value is not None for value in values) and values in parent_values:
                            matches.add(row)
                    if "userId" in columns[table]:
                        assert all(row[columns[table].index("userId")] in EXPECTED for row in matches), "Cascade would affect another account"
                    if not matches.issubset(removed[table]):
                        removed[table].update(matches)
                        changed = True
        expected_remaining = {table: set(before[table]) - removed[table] for table in tables}
        preserved_hash = hashlib.sha256(repr(sorted((table, sorted(rows, key=repr)) for table, rows in expected_remaining.items())).encode()).hexdigest()
        for uid in EXPECTED:
            assert c.execute("DELETE FROM users WHERE id=?", (uid,)).rowcount == 1
        for eid in ENTRIES:
            assert c.execute("SELECT COUNT(*) FROM UserVocabulary WHERE entryId=?", (eid,)).fetchone()[0] == 0
            assert c.execute("DELETE FROM VocabularyEntry WHERE id=?", (eid,)).rowcount == 1
        for table in tables:
            actual = set(c.execute('SELECT * FROM "' + table + '"').fetchall())
            assert actual == expected_remaining[table], "Unrelated rows changed in " + table
        assert c.execute("PRAGMA foreign_key_check").fetchall() == []
        assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        c.commit()
        evidence = {
            "status": "committed", "backup": str(backup),
            "backup_sha256": hashlib.sha256(backup.read_bytes()).hexdigest(),
            "removed_rows_by_table": {table: len(rows) for table, rows in removed.items() if rows},
            "preserved_tables": len(tables), "preserved_rows_sha256": preserved_hash,
            "unrelated_rows_identical": True, "integrity_check": "ok", "foreign_key_violations": 0,
        }
        evidence_path = root / ".planning/project-workflow/synthetic-cleanup-evidence-2026-10-01.json"
        evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(evidence, ensure_ascii=False, indent=2))
    except Exception:
        c.rollback()
        raise
c.close()

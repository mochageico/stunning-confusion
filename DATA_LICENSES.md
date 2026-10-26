# Data licenses

Bundled data that isn't ours, and what each license asks of us.

## `src/content/echoes.json` — UBS Parallel Passage Database

- **Source:** UBS Parallel Passage Database, © 2023 United Bible Societies.
  https://github.com/ubsicap/ubs-open-license (`parallel passages/ParallelPassages.xml`)
- **License:** Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0).
  https://creativecommons.org/licenses/by-sa/4.0/
- **What we did to it:** kept only the passages that pair a New Testament verse with an
  Old Testament verse, reduced them to references (no verse text), converted Old
  Testament verse numbers from the Hebrew system to the English one, and labelled each
  pair `quote` or `allusion` from the word overlap the database records. The script is
  `scripts/build-echoes.cjs`; rerun it on the original XML to reproduce the file.
- **Share-alike:** `echoes.json` is an adaptation of the database, so it is shared
  under the same CC BY-SA 4.0 license. The app's code is a separate work and is not
  covered by it.
- **Credit in the app:** Settings → Help and tour, at the bottom.

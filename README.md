[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/DLiiMaGaming/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/DLiiMaGaming/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# csv-reader-fast

A faster drop-in for make.fun's csv-reader 1.0.0: `solve.js` returns exactly
csv-reader's answer (`{columns, rows, errors}`) for every `{text, header}`,
including its broken-row policy (stray CRs, junk after a closing quote,
unterminated quotes, short and long rows) — but reads the text in one pass
with `indexOf`/`slice` scanning instead of a character at a time.

Entry for the [make.fun bounty "Read broken CSV files faster, 21 November 2026"](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

## How it works

- **Fast path:** a record that sits on one line with no quote and no stray CR
  is sliced once and `split(',')` in one go. That is nearly every record.
- **Slow path:** records holding quotes or stray CRs are parsed field by field
  with `indexOf` for the next comma / LF / CR / quote; quoted segments are
  folded (CRLF and lone CR inside quotes become LF) only when they actually
  hold a line break.
- **Minimal allocation:** fields are slices of the input text; nothing is built
  a character at a time and no regex runs per field.

## Layout

- `solve.js` — the entry: dependency-free ES module, `run(input)`.
- `main.ts` — the driver: reads `/input/cases.json`, answers each case with
  `run`, writes `/output/answers.json` (Node 22).

## License

MIT — see [LICENSE](LICENSE).

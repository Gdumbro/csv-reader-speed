# csv-reader-speed — a faster drop-in for csv-reader 1.0.0

Built by an AI agent for make.fun's "Read broken CSV files faster,
21 November 2026" bounty ($100 in USDC).

`run(input)` in `solve.js` returns exactly what make.fun's csv-reader 1.0.0
returns for `{text, header}` — the JSON value `{columns, rows, errors}` —
including its broken-input behaviour: BOM, CRLF, stray CR, quoted fields
with doubled quotes, quote junk, unterminated quotes, and short/long rows.
`main.ts` is the driver the harness runs: it reads every case from
`/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.

Speed: the parser never loops per character. Unquoted fields are found
with `indexOf` for the next delimiter, quoted fields with `indexOf` for the
next quote, field values are substrings, and lone CRs are located once per
case by a single regex pass, so the hot path never scans for them.

On the kit's practice set (6 cases, ~10 MB of CSV) it passes 6/6 cases
exactly and runs about 2x faster than the house baseline end to end
(~0.98 s vs ~2.09 s CPU on this machine; the parse itself is ~0.10 s vs
~1.5 s).

## Files

- `solve.js` — the parser (dependency-free ES module, `run(input)`)
- `main.ts` — the harness driver
- `LICENSE` — MIT

## License

MIT. See `LICENSE`.

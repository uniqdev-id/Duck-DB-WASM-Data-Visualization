# AGENTS.md

Permanent rules for this project. These apply in every conversation, regardless of which phase is being worked on. Do not violate these even if a specific instruction seems to suggest otherwise — ask first.

## What this project is
A dashboard where chart components are stored in Supabase (not hardcoded), querying a single Parquet file loaded into DuckDB WASM in the browser. Two chart definition modes exist side by side for comparison — see "Mode rules" below. Full background: `SPEC.md` in this repo.

## Hard rules

1. **`@duckdb/duckdb-wasm` is client-side only.** Never import it in a Server Component, Route Handler, or any file that runs on the server. If you're not sure whether a file is server or client, check for `"use client"` before adding the import.

2. **The filter contract.** Every `sql_template` stored in `dashboard_components` must contain the literal substring `{{filter}}` exactly once, inside a WHERE clause. This applies even to charts that don't conceptually need filtering — substitute `1=1` for those, don't omit the placeholder. Never "simplify" this away.

3. **Mode A (declarative) vs Mode B (code) boundary:**
   - Mode A components read `chart_type` + `config` and render via the fixed `DeclarativeChart` switch component.
     - `line`, `bar`, `pie`, `scatter`, `waterfall` → Recharts.
     - `gauge` → `react-gauge-component` (dynamically imported, `ssr: false`). Never hand-roll gauge needle SVG/trig from scratch.
     - `metric` → plain styled card, no charting library.
   - Mode B components receive only a `data` prop (already queried and filtered) and render it. Mode B code must never run its own DuckDB query or build its own filter logic — if you're writing or editing Mode B code and find yourself wanting to fetch data inside it, stop; that means the contract is being violated.
   - Mode B is executed via `react-runner`'s `<Runner>`, not `react-live`. (`react-live` is unmaintained — confirmed June 2026 — do not suggest reverting to it.)

4. **JSON paste-in is an alternate way to fill the same form, not a separate code path.** Whether a component's fields come from manual inputs or a pasted JSON blob, the same validation applies before saving — most importantly, `sql_template` must still contain `{{filter}}` exactly once. Never save parsed JSON straight to the database without running it through the same validation as the manual form.

5. **Chat tools (createChart/updateChart) must call the same shared validator as the JSON paste-in form** — one function, no DOM dependency, imported by both the client form and the server-side chat API route. Never write a second validation implementation for the chat path.

6. **Chat-driven edits/deletes must resolve a chart by id via `listCharts` first.** Never let the model guess an id from a title string without looking it up. If multiple charts could match what the user said, ask for clarification rather than picking one.

7. **`deleteChart` is destructive with no undo — require a UI confirmation step before the tool actually executes**, even if the model has already decided which chart to delete.

8. **Chat tools in this phase only read/write chart *definitions* in Supabase — they never query DuckDB or see actual data.** That's a deliberately separate, not-yet-built capability; don't add it as a side effect of building the chat CRUD tools.

4. **One DuckDB WASM instance per page load.** The Parquet file is registered once (`CREATE TABLE sales AS SELECT * FROM read_parquet(...)`). Only per-chart `SELECT`s re-run on filter change — never re-run `CREATE TABLE`.

5. **Supabase stores chart definitions only.** Never write query results or dataset rows into Postgres.

6. **Every Mode B chart is wrapped in its own error boundary.** A broken pasted snippet must not crash the rest of the dashboard.

7. **Pin exact dependency versions in `package.json`.** Don't install bare `latest` without checking what it resolves to — package version knowledge goes stale fast; verify against npm/the registry before adding or upgrading a dependency.

## Stack notes
- Next.js 16.x (App Router, Turbopack default, Node 20.9+ required).
- React/react-dom 19.x.
- `@duckdb/duckdb-wasm` — pin to the latest non-prerelease stable, currently `1.5.4`; verify, don't assume `latest` dist-tag is stable.
- Recharts 3.8.x for line/bar/pie/scatter/waterfall (Mode A).
- `react-gauge-component` for the `gauge` chart type only (Mode A).
- `react-runner` for Mode B.
- Supabase via `@supabase/supabase-js`; use `@supabase/ssr` if/when auth is added (not `@supabase/auth-helpers-nextjs`, which is deprecated).

## When you're unsure
If a request conflicts with a rule above, say so explicitly and ask before proceeding, rather than silently picking an interpretation.
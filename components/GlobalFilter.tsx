"use client";

/**
 * GlobalFilter — date-range picker that emits a WHERE-clause fragment.
 *
 * Contract (SPEC §5 / AGENTS.md rule 2):
 *  - onChange is called with a string such as
 *    "transaction_at BETWEEN '2026-01-01' AND '2026-03-31'"
 *    or "1=1" when the "All time" preset is active.
 *  - The emitted string is substituted verbatim for {{filter}} in every
 *    chart's sql_template. No chart ever builds its own filter.
 *
 * The filter column is `transaction_at` (a TIMESTAMP column in the sales
 * table). Date literals passed to DuckDB are ISO strings; DuckDB casts them
 * automatically when compared with a TIMESTAMP column.
 */

import { useState, useCallback, useId } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FilterClause = string; // WHERE-clause fragment, never empty

type Preset = {
  label: string;
  clause: FilterClause;
};

// ── Presets ───────────────────────────────────────────────────────────────────

/** Quick-select presets. "All time" → 1=1 per SPEC §5. */
const PRESETS: Preset[] = [
  { label: "All time", clause: "1=1" },
  {
    label: "2026 Q1",
    clause: "transaction_at BETWEEN '2026-01-01' AND '2026-03-31 23:59:59'",
  },
  {
    label: "2026 Q2",
    clause: "transaction_at BETWEEN '2026-04-01' AND '2026-06-30 23:59:59'",
  },
  {
    label: "2026 Q3",
    clause: "transaction_at BETWEEN '2026-07-01' AND '2026-09-30 23:59:59'",
  },
  {
    label: "2026 Q4",
    clause: "transaction_at BETWEEN '2026-10-01' AND '2026-12-31 23:59:59'",
  },
  {
    label: "Full year 2026",
    clause: "transaction_at BETWEEN '2026-01-01' AND '2026-12-31 23:59:59'",
  },
];

const CUSTOM_ID = "__custom__";

// ── Helper ────────────────────────────────────────────────────────────────────

function buildCustomClause(from: string, to: string): FilterClause {
  if (!from && !to) return "1=1";
  if (from && !to) return `transaction_at >= '${from}'`;
  if (!from && to) return `transaction_at <= '${to} 23:59:59'`;
  return `transaction_at BETWEEN '${from}' AND '${to} 23:59:59'`;
}

// ── Component ─────────────────────────────────────────────────────────────────

type GlobalFilterProps = {
  /** Called whenever the filter clause changes. */
  onChange: (clause: FilterClause) => void;
};

export function GlobalFilter({ onChange }: GlobalFilterProps) {
  const [activePreset, setActivePreset] = useState<string>(PRESETS[0].label);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const fromId = useId();
  const toId = useId();

  const selectPreset = useCallback(
    (preset: Preset) => {
      setActivePreset(preset.label);
      onChange(preset.clause);
    },
    [onChange]
  );

  const handleCustomChange = useCallback(
    (from: string, to: string) => {
      setActivePreset(CUSTOM_ID);
      onChange(buildCustomClause(from, to));
    },
    [onChange]
  );

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-sm"
      role="group"
      aria-label="Date range filter"
    >
      {/* Label */}
      <span className="text-xs font-medium uppercase tracking-widest text-slate-500 shrink-0">
        Filter
      </span>

      {/* Preset chips */}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Preset date ranges">
        {PRESETS.map((preset) => {
          const isActive = activePreset === preset.label;
          return (
            <button
              key={preset.label}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => selectPreset(preset)}
              className={[
                "relative rounded-full px-3 py-1 text-xs font-medium transition-all duration-200",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0e1a]",
                isActive
                  ? "bg-indigo-500/25 text-indigo-300 shadow-[0_0_0_1px_rgba(99,102,241,0.5)]"
                  : "bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200",
              ].join(" ")}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <span className="hidden h-4 w-px bg-white/10 sm:block" aria-hidden />

      {/* Custom date range */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500 shrink-0">Custom:</span>

        <div className="flex items-center gap-1.5">
          <label htmlFor={fromId} className="sr-only">From date</label>
          <input
            id={fromId}
            type="date"
            value={customFrom}
            onChange={(e) => {
              setCustomFrom(e.target.value);
              handleCustomChange(e.target.value, customTo);
            }}
            className={[
              "rounded-lg border px-2 py-1 text-xs",
              "bg-white/[0.04] text-slate-300 placeholder-slate-600",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
              activePreset === CUSTOM_ID
                ? "border-indigo-500/50"
                : "border-white/[0.08]",
              // Webkit date picker icon colour
              "[color-scheme:dark]",
            ].join(" ")}
          />

          <span className="text-xs text-slate-600" aria-hidden>→</span>

          <label htmlFor={toId} className="sr-only">To date</label>
          <input
            id={toId}
            type="date"
            value={customTo}
            onChange={(e) => {
              setCustomTo(e.target.value);
              handleCustomChange(customFrom, e.target.value);
            }}
            className={[
              "rounded-lg border px-2 py-1 text-xs",
              "bg-white/[0.04] text-slate-300 placeholder-slate-600",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
              activePreset === CUSTOM_ID
                ? "border-indigo-500/50"
                : "border-white/[0.08]",
              "[color-scheme:dark]",
            ].join(" ")}
          />
        </div>
      </div>

      {/* Active clause readout — helps confirm what was substituted */}
      {activePreset === CUSTOM_ID && (customFrom || customTo) && (
        <div className="w-full mt-0.5">
          <code className="text-[10px] text-slate-600 font-mono">
            WHERE {buildCustomClause(customFrom, customTo)}
          </code>
        </div>
      )}
    </div>
  );
}

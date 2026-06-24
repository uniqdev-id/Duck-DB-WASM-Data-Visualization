"use client";

/**
 * ChartCard — fetches data for one dashboard component and renders it.
 *
 * Contract (AGENTS.md rules 2 + 4):
 *  - Substitutes {{filter}} with the provided filterClause (default '1=1').
 *  - Calls query() from lib/duckdb — never bypasses the singleton.
 *  - Never calls CREATE TABLE or re-initialises DuckDB.
 *  - Mode B is NOT handled here (Step 5).
 *
 * Step 4: accepts optional onDelete — calls DELETE /api/components/[id]
 * and invokes onDelete(id) on success so the parent can remove the card.
 */

import { useCallback, useEffect, useState } from "react";
import { query } from "@/lib/duckdb";
import { DeclarativeChart } from "@/components/DeclarativeChart";
import type { DashboardComponent, QueryRow } from "@/types/dashboard";

// ── Badge for chart type ──────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  line: "Line",
  bar: "Bar",
  pie: "Pie",
  scatter: "Scatter",
  waterfall: "Waterfall",
  gauge: "Gauge",
  metric: "Metric",
};

// ── Loading skeleton ──────────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="mb-3 h-3 w-1/2 rounded-full bg-white/5" />
      <div className="h-[280px] rounded-xl bg-white/[0.03]" />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type ChartCardProps = {
  component: DashboardComponent;
  /** WHERE-clause fragment replacing {{filter}}. Step 3 will wire this up. */
  filterClause?: string;
  /** Step 4: called after the component is successfully deleted. */
  onDelete?: (id: string) => void;
  onEdit?: (component: DashboardComponent) => void;
};

export function ChartCard({ component, filterClause = "1=1", onDelete, onEdit }: ChartCardProps) {
  const [data, setData] = useState<QueryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Delete state (Step 4) ───────────────────────────────────────────────
  const [deleteState, setDeleteState] = useState<"idle" | "confirm" | "deleting">("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteClick = useCallback(() => {
    setDeleteState("confirm");
  }, []);

  const handleDeleteCancel = useCallback(() => {
    setDeleteState("idle");
    setDeleteError(null);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    setDeleteState("deleting");
    setDeleteError(null);
    try {
      const res = await fetch(`/api/components/${component.id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      onDelete?.(component.id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleteState("idle");
    }
  }, [component.id, onDelete]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setData(null);
      setError(null);
      try {
        // SPEC §5: substitute {{filter}} exactly once.
        const sql = component.sql_template.replace("{{filter}}", filterClause);
        const rows = await query<QueryRow>(sql);
        if (!cancelled) setData(rows);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [component.sql_template, filterClause]);

  const chartType = component.chart_type;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 backdrop-blur-sm">
      {/* Card header */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-100">
          {component.title}
        </h2>

        <div className="flex shrink-0 items-center gap-2">
          {chartType && (
            <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
              {TYPE_LABELS[chartType] ?? chartType}
            </span>
          )}

          {/* Edit button */}
          {onEdit && deleteState === "idle" && (
            <button
              type="button"
              onClick={() => onEdit(component)}
              aria-label={`Edit ${component.title}`}
              className="rounded-lg p-1 text-slate-600 hover:bg-white/10 hover:text-indigo-400 transition-colors"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M11 2l3 3L5 14H2v-3L11 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}

          {/* Delete controls (Step 4) */}
          {onDelete && deleteState === "idle" && (
            <button
              type="button"
              onClick={handleDeleteClick}
              aria-label={`Delete ${component.title}`}
              className="rounded-lg p-1 text-slate-600 hover:bg-red-500/10 hover:text-red-400 transition-colors"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M2 4h12M6 4V2h4v2M5 4l1 9h4l1-9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}

          {onDelete && deleteState === "confirm" && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-400">Delete?</span>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="rounded-md bg-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-500/30 transition-colors"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={handleDeleteCancel}
                className="rounded-md bg-white/[0.05] px-2 py-0.5 text-[10px] font-medium text-slate-400 hover:bg-white/[0.09] transition-colors"
              >
                No
              </button>
            </div>
          )}

          {onDelete && deleteState === "deleting" && (
            <span className="text-[10px] text-slate-500 animate-pulse">Deleting…</span>
          )}
        </div>
      </div>

      {/* Delete error */}
      {deleteError && (
        <p className="-mt-2 text-[10px] text-red-400">{deleteError}</p>
      )}

      {/* Chart area */}
      {error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
          <p className="text-xs font-medium text-red-400">Query error</p>
          <pre className="mt-1 overflow-auto text-[10px] text-red-300/70 whitespace-pre-wrap">
            {error}
          </pre>
        </div>
      ) : data === null ? (
        <ChartSkeleton />
      ) : chartType && component.config ? (
        <DeclarativeChart
          chartType={chartType}
          config={component.config}
          data={data}
        />
      ) : (
        <pre className="overflow-auto p-4 text-xs text-slate-400">
          {JSON.stringify(data.slice(0, 5), null, 2)}
        </pre>
      )}
    </div>
  );
}

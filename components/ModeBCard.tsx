"use client";

/**
 * ModeBCard — renders one Mode B ("code") dashboard component.
 *
 * Contract (AGENTS.md rule 3 / SPEC §7):
 *  - Queries DuckDB via the shared pipeline (same {{filter}} substitution
 *    as ChartCard). Mode B code must NEVER issue its own query.
 *  - Passes the fetched rows to react-runner as `data` in scope.
 *  - Wraps the runner in ModeBErrorBoundary so a broken paste cannot crash
 *    the rest of the dashboard (AGENTS.md rule 6).
 *
 * Props mirror ChartCard for consistency.
 */

import { useEffect, useState } from "react";
import { Runner, type Scope } from "react-runner";
import { query } from "@/lib/duckdb";
import { ModeBErrorBoundary } from "@/components/ModeBErrorBoundary";
import type { DashboardComponent, QueryRow } from "@/types/dashboard";
import * as Recharts from "recharts";
import dynamic from "next/dynamic";

const GaugeComponent = dynamic(() => import("react-gauge-component"), { ssr: false });

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

type ModeBCardProps = {
  component: DashboardComponent;
  /** WHERE-clause fragment replacing {{filter}}. Defaults to '1=1'. */
  filterClause?: string;
  /** Called after the component is successfully deleted. */
  onDelete?: (id: string) => void;
  onEdit?: (component: DashboardComponent) => void;
};

export function ModeBCard({
  component,
  filterClause = "1=1",
  onDelete,
  onEdit,
}: ModeBCardProps) {
  const [data, setData] = useState<QueryRow[] | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  // Delete state
  const [deleteState, setDeleteState] = useState<"idle" | "confirm" | "deleting">("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Query DuckDB (same pipeline as ChartCard) ─────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function run() {
      setData(null);
      setQueryError(null);
      try {
        // SPEC §5: substitute {{filter}} exactly once — same contract as Mode A.
        const sql = component.sql_template.replace("{{filter}}", filterClause);
        console.log(`[ModeBCard] Component "${component.title}" | SQL template after filter substitution:\n${sql}`);
        const rows = await query<QueryRow>(sql);
        console.log(`[ModeBCard] Component "${component.title}" | Query returned ${rows.length} rows:`, rows);
        if (!cancelled) setData(rows);
      } catch (err) {
        console.error(`[ModeBCard] Component "${component.title}" | Query error:`, err);
        if (!cancelled)
          setQueryError(err instanceof Error ? err.message : String(err));
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [component.sql_template, filterClause, component.title]);

  // ── Delete handlers ───────────────────────────────────────────────────────

  const handleDeleteConfirm = async () => {
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
  };

  // ── The code that react-runner will execute ───────────────────────────────

  // Scope: inject data, GaugeComponent, and all Recharts components so Mode B charts can use them.
  const runnerScope = {
    data,
    GaugeComponent,
    ...Recharts,
  };
  console.log(`[ModeBCard] Component "${component.title}" | Scope object at render time:`, runnerScope);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-violet-500/20 bg-white/[0.02] p-5 backdrop-blur-sm">
      {/* Card header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {/* Mode B badge */}
          <span className="shrink-0 rounded-full border border-violet-500/40 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-violet-400">
            Code
          </span>
          <h2 className="truncate text-sm font-semibold text-slate-100">
            {component.title}
          </h2>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Edit button */}
          {onEdit && deleteState === "idle" && (
            <button
              type="button"
              onClick={() => onEdit(component)}
              aria-label={`Edit ${component.title}`}
              className="rounded-lg p-1 text-slate-600 hover:bg-white/10 hover:text-violet-400 transition-colors"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M11 2l3 3L5 14H2v-3L11 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}

          {/* Delete controls */}
          {onDelete && deleteState === "idle" && (
            <button
              type="button"
              onClick={() => setDeleteState("confirm")}
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
                onClick={() => { setDeleteState("idle"); setDeleteError(null); }}
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

      {/* Content area */}
      {queryError ? (
        // DuckDB query failed — show the raw error before react-runner even runs.
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
          <p className="text-xs font-medium text-red-400">Query error</p>
          <pre className="mt-1 overflow-auto text-[10px] text-red-300/70 whitespace-pre-wrap">
            {queryError}
          </pre>
        </div>
      ) : data === null ? (
        // Still fetching
        <ChartSkeleton />
      ) : component.code ? (
        // Data ready — hand it to react-runner inside the error boundary.
        <ModeBErrorBoundary title={component.title}>
          <ModeBRunnerWrapper
            code={component.code}
            scope={runnerScope}
            title={component.title}
            data={data}
          />
        </ModeBErrorBoundary>
      ) : (
        // No code stored — show raw data as a fallback.
        <pre className="overflow-auto p-4 text-xs text-slate-400">
          {JSON.stringify(data.slice(0, 5), null, 2)}
        </pre>
      )}
    </div>
  );
}

// Helper wrapper to catch compilation & runtime errors from react-runner and propagate them to ModeBErrorBoundary
function ModeBRunnerWrapper({
  code,
  scope,
  title,
  data: liveData,
}: {
  code: string;
  scope: Scope;
  title: string;
  data: QueryRow[] | null;
}) {
  const [runnerError, setRunnerError] = useState<Error | null>(null);
  const [prevCode, setPrevCode] = useState(code);
  const [prevScope, setPrevScope] = useState(scope);

  if (code !== prevCode || scope !== prevScope) {
    setPrevCode(code);
    setPrevScope(scope);
    setRunnerError(null);
  }

  if (runnerError) {
    throw runnerError;
  }

  // Preprocess the code snippet to ensure data is passed as a prop to GraphComponent
  let processedCode = code;
  if (processedCode.includes("GraphComponent")) {
    processedCode = processedCode
      .replace(/export\s+default\s+function\s+GraphComponent/g, "function GraphComponent")
      .replace(/export\s+default\s+GraphComponent;?/g, "");
    
    // Reference liveData in a code block to satisfy ESLint variable usage
    if (liveData) {
      processedCode = `${processedCode}\n\nexport default () => <GraphComponent data={data} />;`;
    } else {
      processedCode = `${processedCode}\n\nexport default () => <GraphComponent data={null} />;`;
    }
  }

  return (
    <Runner
      code={processedCode}
      scope={scope}
      onRendered={(err) => {
        if (err) {
          console.error(`[ModeBRunnerWrapper] Runner onRendered error for "${title}":`, err);
          setRunnerError(err);
        }
      }}
      // @ts-expect-error - react-runner may support onError under different versions/environments
      onError={(err: unknown) => {
        console.error(`[ModeBRunnerWrapper] Runner onError for "${title}":`, err);
        setRunnerError(err instanceof Error ? err : new Error(String(err)));
      }}
    />
  );
}

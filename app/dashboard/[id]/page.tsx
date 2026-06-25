"use client";

/**
 * /dashboard/[id] — Mode A list view (Step 2) + Global Filter (Step 3)
 *                 + Add / Delete components (Step 4)
 *                 + Mode B (react-runner) components (Step 5).
 *
 * 1. Reads dashboard name + ALL components (both modes) from Supabase.
 * 2. Manages a global filterClause string (WHERE-clause fragment) in state.
 * 3. Renders <GlobalFilter> which lets the user change the date range.
 * 4. Passes filterClause down to every card; when it changes every card
 *    re-runs its DuckDB query via the {{filter}} substitution.
 * 5. (Step 4) "Add chart" button opens <AddComponentModal>; on success the
 *    new component is appended to local state — no full re-fetch needed.
 * 6. (Step 4) onDelete callback removes the card from local state after
 *    the API call succeeds.
 * 7. (Step 5) Mode B components are rendered by <ModeBCard> which passes
 *    fetched data to react-runner's <Runner>. Mode B code never fetches its
 *    own data (AGENTS.md rule 3 / SPEC §7).
 *
 * AGENTS.md rules enforced:
 *  - DuckDB import lives in ChartCard / ModeBCard → lib/duckdb (never here).
 *  - This file only reads / mutates chart *definitions* via Supabase.
 *  - filterClause starts as '1=1' (SPEC §5 rule: always include {{filter}}).
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ChartCard } from "@/components/ChartCard";
import { ModeBCard } from "@/components/ModeBCard";
import { GlobalFilter } from "@/components/GlobalFilter";
import { AddComponentModal } from "@/components/AddComponentModal";
import { ChatPanel } from "@/components/ChatPanel";
import type { Dashboard, DashboardComponent } from "@/types/dashboard";
import { useDuckDb } from "@/lib/duckdb";

// ── Loading skeletons ─────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="h-3 w-1/3 rounded-full bg-white/[0.06]" />
        <div className="h-4 w-12 rounded-full bg-white/[0.06]" />
      </div>
      <div className="h-[280px] rounded-xl bg-white/[0.03]" />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type LoadState =
  | { phase: "loading" }
  | { phase: "ok"; dashboard: Dashboard; components: DashboardComponent[] }
  | { phase: "error"; message: string };

export default function DashboardPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const { loading: dbLoading, error: dbError } = useDuckDb();

  // ── Global filter state (Step 3) ──────────────────────────────────────────
  // Default to '1=1' so every chart loads immediately on mount (SPEC §5).
  const [filterClause, setFilterClause] = useState<string>("1=1");

  // ── Add-component modal (Step 4) ──────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingComponent, setEditingComponent] = useState<DashboardComponent | null>(null);

  // ── Step 6: update component in local state after patch succeeds ─────────
  const handleComponentUpdated = useCallback((updated: DashboardComponent) => {
    setState((prev) => {
      if (prev.phase !== "ok") return prev;
      return {
        ...prev,
        components: prev.components.map((c) => (c.id === updated.id ? updated : c)),
      };
    });
  }, []);

  const handleEditClick = useCallback((component: DashboardComponent) => {
    setEditingComponent(component);
  }, []);

  // Stable callback for GlobalFilter — avoids unnecessary re-renders.
  const handleFilterChange = useCallback((clause: string) => {
    setFilterClause(clause);
  }, []);

  // ── Load dashboard + components from Supabase ─────────────────────────────

  useEffect(() => {
    if (!id) return;

    async function load() {
      setState({ phase: "loading" });
      try {
        const [{ data: dash, error: dashErr }, { data: comps, error: compsErr }] =
          await Promise.all([
            supabase.from("dashboards").select("*").eq("id", id).single(),
            supabase
              .from("dashboard_components")
              .select("*")
              .eq("dashboard_id", id)
              .order("position"),
          ]);

        if (dashErr) throw new Error(`Dashboard: ${dashErr.message}`);
        if (compsErr) throw new Error(`Components: ${compsErr.message}`);

        setState({
          phase: "ok",
          dashboard: dash as Dashboard,
          // Step 5: include ALL components (both modes), ordered by position.
          components: (comps ?? []) as DashboardComponent[],
        });
      } catch (err) {
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    load();
  }, [id]);

  // ── Step 4: append a newly created component to local state ──────────────
  const handleComponentCreated = useCallback((component: DashboardComponent) => {
    setState((prev) => {
      if (prev.phase !== "ok") return prev;
      return { ...prev, components: [...prev.components, component] };
    });
  }, []);

  // ── Step 4: remove a deleted component from local state ──────────────────
  const handleComponentDeleted = useCallback((deletedId: string) => {
    setState((prev) => {
      if (prev.phase !== "ok") return prev;
      return {
        ...prev,
        components: prev.components.filter((c) => c.id !== deletedId),
      };
    });
  }, []);

  // ── Error ──────────────────────────────────────────────────────────────────

  if (state.phase === "error" || dbError) {
    const errorMsg = dbError ? dbError.message : (state.phase === "error" ? state.message : "An error occurred");
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0c0e1a] p-8 text-center">
        <p className="text-sm font-medium text-red-400">Failed to load dashboard or database</p>
        <pre className="max-w-md overflow-auto rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-left text-xs text-red-300/70">
          {errorMsg}
        </pre>
      </main>
    );
  }

  const dashboard = state.phase === "ok" ? state.dashboard : null;
  const components = state.phase === "ok" ? state.components : [];

  // ── Layout ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0c0e1a]">
      {/* Subtle radial glow in the background */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(99,102,241,0.15) 0%, transparent 70%)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-6 py-10">
        {/* ── Header ── */}
        <header className="mb-6 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {/* Logo dot */}
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-indigo-400" />
              <p className="text-xs font-medium uppercase tracking-widest text-indigo-400">
                Dashboard Experiment
              </p>
            </div>

            {/* ── Add chart button (Step 4) ── */}
            {state.phase === "ok" && (
              <button
                id="add-chart-btn"
                type="button"
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-500/20 hover:border-indigo-500/60 transition-all active:scale-[0.97]"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                >
                  <path d="M8 2v12M2 8h12" strokeLinecap="round" />
                </svg>
                Add chart
              </button>
            )}
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {state.phase === "loading" ? (
              <span className="inline-block h-7 w-48 animate-pulse rounded-lg bg-white/10" />
            ) : (
              dashboard?.name ?? "Dashboard"
            )}
          </h1>

          {dashboard && (() => {
            const modeA = components.filter((c) => c.mode === "declarative").length;
            const modeB = components.filter((c) => c.mode === "code").length;
            return (
              <p className="text-xs text-slate-500">
                <span className="font-medium text-slate-400">{components.length}</span>{" "}
                chart{components.length !== 1 ? "s" : ""}
                {modeA > 0 && (
                  <span className="ml-1.5 inline-flex items-center gap-1">
                    <span className="rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-400">{modeA} A</span>
                  </span>
                )}
                {modeB > 0 && (
                  <span className="ml-1 inline-flex items-center gap-1">
                    <span className="rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-violet-400">{modeB} B</span>
                  </span>
                )}
              </p>
            );
          })()}
        </header>

        {/* ── Global Filter (Step 3) ── */}
        <div className="mb-6">
          <GlobalFilter onChange={handleFilterChange} />
        </div>

        {/* ── Active filter readout ── */}
        {filterClause !== "1=1" && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-xs text-slate-500">Active WHERE:</span>
            <code className="rounded-md bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] text-indigo-300">
              {filterClause}
            </code>
          </div>
        )}

        {/* ── Chart grid ── */}
        {state.phase === "loading" || dbLoading ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : components.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/10 py-24 text-center">
            <p className="text-sm font-medium text-slate-400">
              No charts yet
            </p>
            <p className="text-xs text-slate-600">
              Click{" "}
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="text-indigo-400 underline underline-offset-2 hover:text-indigo-300 transition-colors"
              >
                Add chart
              </button>{" "}
              to insert your first component.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {components.map((comp) =>
              comp.mode === "code" ? (
                // Step 5: Mode B — rendered by react-runner inside ModeBCard.
                // ModeBCard fetches data via the shared pipeline then passes
                // it as the sole prop to the pasted JSX snippet.
                <ModeBCard
                  key={comp.id}
                  component={comp}
                  filterClause={filterClause}
                  onDelete={handleComponentDeleted}
                  onEdit={handleEditClick}
                />
              ) : (
                // Mode A — declarative Recharts chart.
                <ChartCard
                  key={comp.id}
                  component={comp}
                  filterClause={filterClause}
                  onDelete={handleComponentDeleted}
                  onEdit={handleEditClick}
                />
              )
            )}
          </div>
        )}
      </div>

      {/* ── Add / Edit component modal (Step 4 & Step 6) ── */}
      {(showAddModal || editingComponent) && state.phase === "ok" && (
        <AddComponentModal
          dashboardId={state.dashboard.id}
          nextPosition={components.length}
          component={editingComponent || undefined}
          onClose={() => {
            setShowAddModal(false);
            setEditingComponent(null);
          }}
          onCreated={handleComponentCreated}
          onUpdated={handleComponentUpdated}
        />
      )}

      {/* ── AI Chat Assistant Panel (Step 8) ── */}
      {state.phase === "ok" && (
        <ChatPanel
          dashboardId={state.dashboard.id}
          components={components}
          onComponentCreated={handleComponentCreated}
          onComponentUpdated={handleComponentUpdated}
          onComponentDeleted={handleComponentDeleted}
        />
      )}
    </div>
  );
}

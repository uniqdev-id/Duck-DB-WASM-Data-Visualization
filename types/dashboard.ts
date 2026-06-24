/**
 * TypeScript types mirroring the Supabase schema (SPEC §4).
 * Keep in sync with supabase/schema.sql.
 */

// ── Config shapes for Mode A (declarative) ──────────────────────────────────

export type LineBarConfig = {
  xField: string;
  yField: string;
  seriesField?: string;
};

export type PieConfig = {
  labelField: string;
  valueField: string;
};

export type ScatterConfig = {
  xField: string;
  yField: string;
  seriesField?: string;
};

export type WaterfallConfig = {
  labelField: string;
  valueField: string;
  totalLabels?: string[];
};

export type GaugeConfig = {
  valueField: string;
  min: number;
  max: number;
  thresholds?: { value: number; color: string }[];
};

export type MetricConfig = {
  valueField: string;
  label: string;
  compareField?: string;
  format?: "number" | "currency" | "percent";
};

export type ChartConfig =
  | LineBarConfig
  | PieConfig
  | ScatterConfig
  | WaterfallConfig
  | GaugeConfig
  | MetricConfig;

// ── Supabase table rows ──────────────────────────────────────────────────────

export type Dashboard = {
  id: string;
  name: string;
  parquet_url: string;
  created_at: string;
};

export type DashboardComponent = {
  id: string;
  dashboard_id: string;
  title: string;
  mode: "declarative" | "code";
  position: number;
  /** Must contain {{filter}} exactly once (SPEC §5 / AGENTS.md rule 2). */
  sql_template: string;
  // Mode A fields
  chart_type?:
    | "line"
    | "bar"
    | "pie"
    | "scatter"
    | "waterfall"
    | "gauge"
    | "metric";
  config?: ChartConfig;
  // Mode B field (Step 5)
  code?: string;
  created_at: string;
  updated_at: string;
};

// ── Query row — plain JS objects returned by lib/duckdb query() ─────────────

export type QueryRow = Record<string, string | number | boolean | null>;

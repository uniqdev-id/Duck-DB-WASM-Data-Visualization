"use client";

/**
 * AddComponentModal — inserts or updates a chart component (Mode A or Mode B).
 *
 * Contract (AGENTS.md):
 *  - Validates that sql_template includes {{filter}} before submitting (rule 2).
 *  - Only writes chart *definitions* to Supabase (rule 5).
 *  - No DuckDB import here (rule 1).
 *
 * Step 6 changes:
 *  - Supports "Edit" mode when `component` prop is provided.
 *  - Adds a "Paste JSON" toggle switch alongside "Manual fields".
 *  - Validates pasted JSON on form submit: if successful, pre-fills the manual
 *    fields and switches back to manual input mode for confirmation before saving.
 */

import { useCallback, useId, useRef, useState, useEffect } from "react";
import type { DashboardComponent, LineBarConfig, PieConfig } from "@/types/dashboard";
import { validateChartDefinition } from "@/lib/validateChartDefinition";

// ── AI Prompts ───────────────────────────────────────────────────────────────

export const PROMPT_MODE_A = `I'm building a chart for a dashboard. The chart will query a table called 'sales'
(loaded from a Parquet file into DuckDB). Here are the actual columns and types:

- transaction_at (TIMESTAMP WITH TIME ZONE)
- modified_at (TIMESTAMP WITH TIME ZONE)
- sales_id (VARCHAR)
- sales_detail_id (INTEGER)
- store_id (INTEGER)
- product_id (INTEGER)
- product_detail_fkid (INTEGER)
- parent_detail_id (INTEGER)
- open_shift_fkid (BIGINT)
- member_fkid (INTEGER)
- tx_status (VARCHAR)
- qty (DOUBLE)
- qty_original (INTEGER)
- qty_voided (DOUBLE)
- has_void (BOOLEAN)
- unit_price (INTEGER)
- unit_price_add (INTEGER)
- item_subtotal (INTEGER)
- item_discount (DOUBLE)
- item_voucher (DOUBLE)
- item_promotion (DOUBLE)
- item_tax (DOUBLE)
- item_service (DOUBLE)
- tx_grand_total (INTEGER)
- tx_discount (INTEGER)
- tx_voucher (INTEGER)

I need a chart that shows: 
[ASK ME IN THE CHAT, And Give Suggestions].

Output ONLY a JSON object with this exact shape, nothing else — no markdown
fences, no explanation:

{
  "title": "string, short human-readable name",
  "chart_type": "line" | "bar" | "pie" | "scatter" | "waterfall" | "gauge" | "metric",
  "sql_template": "a DuckDB SQL SELECT statement",
  "config": { ... }
}

Rules for sql_template:
- It must run against a table named 'sales'.
- It MUST contain the literal substring {{filter}} exactly once, inside a WHERE
  clause (e.g. WHERE {{filter}}). This is a placeholder my app substitutes at
  runtime — even if the chart doesn't need filtering, include "WHERE {{filter}}"
  and rely on it being replaced with 1=1.
- Alias every output column to a clear name I can reference in config (e.g.
  AS month, AS total).
- tx_grand_total, item_subtotal, unit_price, and similar fields are stored as
  integers in minor currency units unless I say otherwise — don't assume they
  need dividing, and don't silently divide by 100 unless I explicitly ask for it.
- For chart_type "gauge" or "metric", the query must return EXACTLY ONE ROW.
  If you need a comparison value (e.g. vs. a prior period), either compute it
  in the same single-row query (e.g. via a subquery) or tell me explicitly that
  it needs a second query — don't silently return multiple rows.
- Sanity-check your own aggregation before responding: if a SUM/COUNT could be
  inflated by a join fanout (e.g. joining sales to another table that has
  multiple rows per sales_id), avoid the join or use a pre-aggregated subquery
  instead. A single product's total should be a plausible real-world number,
  not orders of magnitude larger than the rest.

Rules for config, depending on chart_type — use the EXACT field names below,
and make sure every field name matches an alias from your own sql_template's
SELECT list (don't invent new field names that aren't in the query):

- "line" or "bar": { "xField": string, "yField": string, "seriesField"?: string }
- "pie": { "labelField": string, "valueField": string }
- "scatter": { "xField": string, "yField": string, "seriesField"?: string }
- "waterfall": { "labelField": string, "valueField": string, "totalLabels"?: string[] }
  — totalLabels lists which labelField values (e.g. "Net Total") should render
  as anchored/total bars instead of floating delta bars. Only include this if
  the chart actually has a running-total/cumulative structure — don't force
  waterfall onto data that isn't naturally sequential.
- "gauge": { "valueField": string, "min": number, "max": number,
  "thresholds"?: [{ "value": number, "color": string }] }
  — valueField must be a single numeric value from the one-row result.
- "metric": { "valueField": string, "label": string, "compareField"?: string,
  "format"?: "number" | "currency" | "percent" }
  — valueField and compareField (if present) must come from the one-row result.

Double-check before responding: does chart_type match what the data shape can
actually support (e.g. don't pick "gauge" for a multi-row time series), and does
every field name in config actually exist in your sql_template's SELECT aliases?`;

export const PROMPT_MODE_B = `I'm building a chart for a dashboard. The chart code will be a React component
that receives ALREADY-QUERIED, ALREADY-FILTERED data as a prop — it must not
query anything itself.

The data will be an array of objects. Each object's keys come from this SQL
query that runs against a DuckDB table called 'sales' (columns below):

- transaction_at (TIMESTAMP WITH TIME ZONE)
- modified_at (TIMESTAMP WITH TIME ZONE)
- sales_id (VARCHAR)
- sales_detail_id (INTEGER)
- store_id (INTEGER)
- product_id (INTEGER)
- product_detail_fkid (INTEGER)
- parent_detail_id (INTEGER)
- open_shift_fkid (BIGINT)
- member_fkid (INTEGER)
- tx_status (VARCHAR)
- qty (DOUBLE)
- qty_original (INTEGER)
- qty_voided (DOUBLE)
- has_void (BOOLEAN)
- unit_price (INTEGER)
- unit_price_add (INTEGER)
- item_subtotal (INTEGER)
- item_discount (DOUBLE)
- item_voucher (DOUBLE)
- item_promotion (DOUBLE)
- item_tax (DOUBLE)
- item_service (DOUBLE)
- tx_grand_total (INTEGER)
- tx_discount (INTEGER)
- tx_voucher (INTEGER)

I want a chart that shows: 
[ASK ME IN THE CHAT, And Give Suggestions].

Output TWO things, clearly separated, nothing else (no extra explanation):

1. A field called "sql_template" — a DuckDB SQL SELECT statement against 'sales'
   that produces the rows needed for this chart. Rules:
   - Must contain the literal substring {{filter}} exactly once, inside a WHERE
     clause (e.g. "WHERE {{filter}}"). This is a placeholder my app replaces at
     runtime — include it even if you think the chart doesn't need filtering.
   - Alias every selected column to a clear name (e.g. AS day, AS total).
   - If the chart is a gauge or metric/tile, the query must return exactly ONE row.
   - tx_grand_total, item_subtotal, etc. are stored as integers in minor currency
     units unless I say otherwise — don't assume they need dividing.

2. A field called "code" — a single React functional component as a JSX string.
   Rules:
   - The component must be named GraphComponent and accept exactly one prop: data
     (an array of row objects, keys matching the SQL aliases from part 1).
   - Do NOT fetch, query, or filter data inside this component — only render the
     data prop you're given.
   - You may use these, already in scope, without importing them:
     LineChart, BarChart, PieChart, ScatterChart, Line, Bar, Pie, Scatter,
     XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
     (all from Recharts), and GaugeComponent (from react-gauge-component, for
     gauges only).
   - For a waterfall, compute the running total / [low, high] bar ranges
     yourself inside the component from the raw data rows — don't assume the
     SQL already did it.
   - For a metric/tile, don't use any chart library — just render styled text
     (e.g. a big number and a label) using plain JSX and Tailwind classes.
   - Do not write your own <svg> from scratch for anything other than basic
     layout — use the components listed above where one exists for the chart
     type you're building.
   - Output only valid JSX, no import statements, no markdown fences.

Format your answer as raw JSON: { "sql_template": "...", "code": "...", "title": "..." }`;

// ── Types ─────────────────────────────────────────────────────────────────────

type TabMode = "declarative" | "code";
type ChartType = "line" | "bar" | "pie" | "scatter" | "waterfall" | "gauge" | "metric";

type ModeAForm = {
  title: string;
  chart_type: ChartType;
  sql_template: string;
  xField: string;
  yField: string;
  seriesField: string;
  labelField: string;
  valueField: string;
  waterfallTotalLabels: string;
  gaugeMin: string;
  gaugeMax: string;
  gaugeThresholds: string;
  metricLabel: string;
  metricCompareField: string;
  metricFormat: "number" | "currency" | "percent";
};

type ModeBForm = {
  title: string;
  sql_template: string;
  code: string;
};

const DEFAULT_A: ModeAForm = {
  title: "",
  chart_type: "bar",
  sql_template:
    "SELECT category, sum(amount) AS total\nFROM sales\nWHERE {{filter}}\nGROUP BY 1\nORDER BY 2 DESC",
  xField: "category",
  yField: "total",
  seriesField: "",
  labelField: "category",
  valueField: "total",
  waterfallTotalLabels: "",
  gaugeMin: "0",
  gaugeMax: "100",
  gaugeThresholds: "",
  metricLabel: "",
  metricCompareField: "",
  metricFormat: "number",
};

const DEFAULT_B: ModeBForm = {
  title: "",
  sql_template:
    "SELECT category, sum(amount) AS total\nFROM sales\nWHERE {{filter}}\nGROUP BY 1\nORDER BY 2 DESC",
  code: `// \`data\` is the array of row objects from DuckDB — render it however you like.
// This component must NOT fetch data; it only visualises the \`data\` prop.
// Export a default React component (or write a bare JSX expression).

export default function Chart({ data }) {
  return (
    <div style={{ padding: "1rem", color: "#e2e8f0", fontFamily: "monospace", fontSize: "12px" }}>
      <p style={{ marginBottom: "0.5rem", color: "#a78bfa" }}>Rows: {data.length}</p>
      <pre style={{ overflow: "auto", maxHeight: "240px" }}>
        {JSON.stringify(data.slice(0, 10), null, 2)}
      </pre>
    </div>
  );
}`,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasFilterPlaceholder(sql: string) {
  return sql.includes("{{filter}}");
}

function useEscapeKey(onEscape: () => void) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onEscape();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onEscape]);
}

// ── Shared input / textarea styles ────────────────────────────────────────────

const inputCls =
  "rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-indigo-500/60 focus:outline-none focus:ring-1 focus:ring-indigo-500/40";

const codeCls =
  "rounded-xl border bg-white/[0.04] px-3 py-2 font-mono text-xs text-slate-200 placeholder-slate-600 resize-y focus:outline-none focus:ring-1";

function sqlBorderCls(ok: boolean) {
  return ok
    ? "border-white/[0.08] focus:border-indigo-500/60 focus:ring-indigo-500/40"
    : "border-red-500/40 focus:border-red-500/60 focus:ring-red-500/30";
}

// ── Component ─────────────────────────────────────────────────────────────────

type AddComponentModalProps = {
  dashboardId: string;
  nextPosition: number;
  onClose: () => void;
  onCreated?: (component: DashboardComponent) => void;
  onUpdated?: (component: DashboardComponent) => void;
  component?: DashboardComponent; // Undefined in create mode, present in edit mode
};

export function AddComponentModal({
  dashboardId,
  nextPosition,
  onClose,
  onCreated,
  onUpdated,
  component,
}: AddComponentModalProps) {
  const [tab, setTab] = useState<TabMode>(component?.mode ?? "declarative");

  const [formA, setFormA] = useState<ModeAForm>(() => {
    if (component && component.mode === "declarative") {
      const chartType = component.chart_type ?? "bar";
      const cfg = component.config ?? {};
      const isPie = chartType === "pie";
      const isWaterfall = chartType === "waterfall";
      const isGauge = chartType === "gauge";
      const isMetric = chartType === "metric";
      const isScatter = chartType === "scatter";
      const isLineOrBar = chartType === "line" || chartType === "bar";

      return {
        title: component.title,
        chart_type: chartType,
        sql_template: component.sql_template,
        xField: (isLineOrBar || isScatter) ? (cfg as any).xField || "" : "",
        yField: (isLineOrBar || isScatter) ? (cfg as any).yField || "" : "",
        seriesField: (isLineOrBar || isScatter) ? (cfg as any).seriesField || "" : "",
        labelField: (isPie || isWaterfall) ? (cfg as any).labelField || "" : "",
        valueField: (isPie || isWaterfall || isGauge || isMetric) ? (cfg as any).valueField || "" : "",
        waterfallTotalLabels: isWaterfall && (cfg as any).totalLabels ? (cfg as any).totalLabels.join(", ") : "",
        gaugeMin: isGauge ? String((cfg as any).min ?? 0) : "0",
        gaugeMax: isGauge ? String((cfg as any).max ?? 100) : "100",
        gaugeThresholds: isGauge && (cfg as any).thresholds ? JSON.stringify((cfg as any).thresholds, null, 2) : "",
        metricLabel: isMetric ? (cfg as any).label || "" : "",
        metricCompareField: isMetric ? (cfg as any).compareField || "" : "",
        metricFormat: isMetric ? (cfg as any).format || "number" : "number",
      };
    }
    return DEFAULT_A;
  });

  // Keep track of extra keys in declarative config (e.g. thresholds, seriesField, min, max)
  const [formAConfigExtra, setFormAConfigExtra] = useState<any>(() => {
    if (component && component.mode === "declarative") {
      return component.config ?? {};
    }
    return {};
  });

  // Initialize Mode B Form
  const [formB, setFormB] = useState<ModeBForm>(() => {
    if (component && component.mode === "code") {
      return {
        title: component.title,
        sql_template: component.sql_template,
        code: component.code ?? "",
      };
    }
    return DEFAULT_B;
  });

  // JSON paste-in state
  const [inputMode, setInputMode] = useState<"manual" | "json">("manual");
  const [jsonText, setJsonText] = useState("");
  const [jsonSuccessMsg, setJsonSuccessMsg] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);
  const handleCopyPrompt = useCallback(() => {
    const promptText = tab === "declarative" ? PROMPT_MODE_A : PROMPT_MODE_B;
    navigator.clipboard.writeText(promptText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [tab]);

  // ID hooks for label→input associations
  const titleAId = useId();
  const typeId = useId();
  const sqlAId = useId();
  const xId = useId();
  const yId = useId();
  const labelId = useId();
  const valueId = useId();
  const titleBId = useId();
  const sqlBId = useId();
  const codeId = useId();
  const jsonTextId = useId();

  const overlayRef = useRef<HTMLDivElement>(null);
  useEscapeKey(onClose);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose]
  );

  const setA = useCallback(
    <K extends keyof ModeAForm>(key: K, value: ModeAForm[K]) => {
      setFormA((f) => ({ ...f, [key]: value }));
      setJsonSuccessMsg(null);
    },
    []
  );
  const setB = useCallback(
    <K extends keyof ModeBForm>(key: K, value: ModeBForm[K]) => {
      setFormB((f) => ({ ...f, [key]: value }));
      setJsonSuccessMsg(null);
    },
    []
  );

  const getFormAsJson = useCallback(() => {
    if (tab === "declarative") {
      const configObj: Record<string, any> = { ...formAConfigExtra };
      if (formA.chart_type === "line" || formA.chart_type === "bar" || formA.chart_type === "scatter") {
        configObj.xField = formA.xField;
        configObj.yField = formA.yField;
        if (formA.seriesField) {
          configObj.seriesField = formA.seriesField;
        } else {
          delete configObj.seriesField;
        }
      } else if (formA.chart_type === "pie") {
        configObj.labelField = formA.labelField;
        configObj.valueField = formA.valueField;
      } else if (formA.chart_type === "waterfall") {
        configObj.labelField = formA.labelField;
        configObj.valueField = formA.valueField;
        if (formA.waterfallTotalLabels) {
          configObj.totalLabels = formA.waterfallTotalLabels.split(",").map(s => s.trim()).filter(Boolean);
        } else {
          delete configObj.totalLabels;
        }
      } else if (formA.chart_type === "gauge") {
        configObj.valueField = formA.valueField;
        configObj.min = Number(formA.gaugeMin) || 0;
        configObj.max = Number(formA.gaugeMax) || 100;
        if (formA.gaugeThresholds) {
          try {
            configObj.thresholds = JSON.parse(formA.gaugeThresholds);
          } catch {
            // Keep original if invalid
          }
        }
      } else if (formA.chart_type === "metric") {
        configObj.valueField = formA.valueField;
        configObj.label = formA.metricLabel;
        if (formA.metricCompareField) {
          configObj.compareField = formA.metricCompareField;
        } else {
          delete configObj.compareField;
        }
        configObj.format = formA.metricFormat;
      }

      return JSON.stringify(
        {
          title: formA.title,
          chart_type: formA.chart_type,
          sql_template: formA.sql_template,
          config: configObj,
        },
        null,
        2
      );
    } else {
      return JSON.stringify(
        {
          title: formB.title,
          sql_template: formB.sql_template,
          code: formB.code,
        },
        null,
        2
      );
    }
  }, [tab, formA, formAConfigExtra, formB]);

  // ── Parse & Load JSON ──────────────────────────────────────────────────────

  const handleLoadJson = useCallback(() => {
    setApiError(null);
    setJsonSuccessMsg(null);

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      setApiError("Invalid JSON format. Please verify standard JSON syntax.");
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      setApiError("JSON must be an object.");
      return;
    }

    // Call the shared validation function
    const validation = validateChartDefinition({
      ...parsed,
      mode: tab, // override mode with current tab context
    });

    if (!validation.isValid) {
      setApiError(validation.error ?? "Validation failed.");
      return;
    }

    const titleVal = parsed.title !== undefined ? String(parsed.title).trim() : (tab === "declarative" ? formA.title : formB.title);

    if (tab === "declarative") {
      const cfg = parsed.config || {};
      const chartType = parsed.chart_type;
      const isPie = chartType === "pie";
      const isWaterfall = chartType === "waterfall";
      const isGauge = chartType === "gauge";
      const isMetric = chartType === "metric";
      const isScatter = chartType === "scatter";
      const isLineOrBar = chartType === "line" || chartType === "bar";

      const xF = (isLineOrBar || isScatter) ? cfg.xField || "" : "";
      const yF = (isLineOrBar || isScatter) ? cfg.yField || "" : "";
      const sF = (isLineOrBar || isScatter) ? cfg.seriesField || "" : "";
      const lF = (isPie || isWaterfall) ? cfg.labelField || "" : "";
      const vF = (isPie || isWaterfall || isGauge || isMetric) ? cfg.valueField || "" : "";
      const wTL = isWaterfall && cfg.totalLabels ? (Array.isArray(cfg.totalLabels) ? cfg.totalLabels.join(", ") : String(cfg.totalLabels)) : "";
      const gMin = isGauge ? String(cfg.min ?? 0) : "0";
      const gMax = isGauge ? String(cfg.max ?? 100) : "100";
      const gTh = isGauge && cfg.thresholds ? JSON.stringify(cfg.thresholds, null, 2) : "";
      const mLabel = isMetric ? cfg.label || "" : "";
      const mComp = isMetric ? cfg.compareField || "" : "";
      const mFmt = isMetric ? cfg.format || "number" : "number";

      setFormA({
        title: titleVal,
        chart_type: chartType as any,
        sql_template: parsed.sql_template,
        xField: xF,
        yField: yF,
        seriesField: sF,
        labelField: lF,
        valueField: vF,
        waterfallTotalLabels: wTL,
        gaugeMin: gMin,
        gaugeMax: gMax,
        gaugeThresholds: gTh,
        metricLabel: mLabel,
        metricCompareField: mComp,
        metricFormat: mFmt,
      });
      setFormAConfigExtra(cfg);
    } else {
      setFormB({
        title: titleVal,
        sql_template: parsed.sql_template,
        code: parsed.code,
      });
    }

    setJsonSuccessMsg("JSON parsed successfully! Review the manual fields below.");
    setInputMode("manual");
  }, [jsonText, tab, formA.title, formB.title]);

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setApiError(null);

      const isEdit = !!component;

      if (tab === "declarative") {
        const config: Record<string, any> = { ...formAConfigExtra };
        if (formA.chart_type === "line" || formA.chart_type === "bar" || formA.chart_type === "scatter") {
          config.xField = formA.xField.trim();
          config.yField = formA.yField.trim();
          if (formA.seriesField.trim()) {
            config.seriesField = formA.seriesField.trim();
          } else {
            delete config.seriesField;
          }
          delete config.labelField;
          delete config.valueField;
          delete config.totalLabels;
          delete config.min;
          delete config.max;
          delete config.thresholds;
          delete config.label;
          delete config.compareField;
          delete config.format;
        } else if (formA.chart_type === "pie") {
          config.labelField = formA.labelField.trim();
          config.valueField = formA.valueField.trim();
          delete config.xField;
          delete config.yField;
          delete config.seriesField;
          delete config.totalLabels;
          delete config.min;
          delete config.max;
          delete config.thresholds;
          delete config.label;
          delete config.compareField;
          delete config.format;
        } else if (formA.chart_type === "waterfall") {
          config.labelField = formA.labelField.trim();
          config.valueField = formA.valueField.trim();
          if (formA.waterfallTotalLabels.trim()) {
            config.totalLabels = formA.waterfallTotalLabels
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
          } else {
            delete config.totalLabels;
          }
          delete config.xField;
          delete config.yField;
          delete config.seriesField;
          delete config.min;
          delete config.max;
          delete config.thresholds;
          delete config.label;
          delete config.compareField;
          delete config.format;
        } else if (formA.chart_type === "gauge") {
          config.valueField = formA.valueField.trim();
          config.min = Number(formA.gaugeMin) || 0;
          config.max = Number(formA.gaugeMax) || 100;
          if (formA.gaugeThresholds.trim()) {
            try {
              config.thresholds = JSON.parse(formA.gaugeThresholds);
            } catch {
              setApiError("Invalid JSON in thresholds. Format: [{\"value\": 50, \"color\": \"#ff0000\"}]");
              return;
            }
          } else {
            delete config.thresholds;
          }
          delete config.xField;
          delete config.yField;
          delete config.seriesField;
          delete config.labelField;
          delete config.totalLabels;
          delete config.label;
          delete config.compareField;
          delete config.format;
        } else if (formA.chart_type === "metric") {
          config.valueField = formA.valueField.trim();
          config.label = formA.metricLabel.trim();
          if (formA.metricCompareField.trim()) {
            config.compareField = formA.metricCompareField.trim();
          } else {
            delete config.compareField;
          }
          config.format = formA.metricFormat;
          delete config.xField;
          delete config.yField;
          delete config.seriesField;
          delete config.labelField;
          delete config.totalLabels;
          delete config.min;
          delete config.max;
          delete config.thresholds;
        }

        // Validate using the shared validator
        const validation = validateChartDefinition({
          title: formA.title,
          mode: "declarative",
          sql_template: formA.sql_template,
          chart_type: formA.chart_type,
          config,
        });

        if (!validation.isValid) {
          setApiError(validation.error ?? "Validation failed.");
          return;
        }

        setSubmitting(true);
        try {
          const url = isEdit ? `/api/components/${component.id}` : "/api/components";
          const method = isEdit ? "PATCH" : "POST";

          const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dashboard_id: dashboardId,
              title: formA.title.trim(),
              mode: "declarative",
              position: isEdit ? component.position : nextPosition,
              sql_template: formA.sql_template,
              chart_type: formA.chart_type,
              config,
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            setApiError(json.error ?? "Unknown error");
            return;
          }

          if (isEdit) {
            onUpdated?.(json.component as DashboardComponent);
          } else {
            onCreated?.(json.component as DashboardComponent);
          }
          onClose();
        } catch (err) {
          setApiError(err instanceof Error ? err.message : String(err));
        } finally {
          setSubmitting(false);
        }
      } else {
        // Mode B
        const validation = validateChartDefinition({
          title: formB.title,
          mode: "code",
          sql_template: formB.sql_template,
          code: formB.code,
        });

        if (!validation.isValid) {
          setApiError(validation.error ?? "Validation failed.");
          return;
        }

        setSubmitting(true);
        try {
          const url = isEdit ? `/api/components/${component.id}` : "/api/components";
          const method = isEdit ? "PATCH" : "POST";

          const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dashboard_id: dashboardId,
              title: formB.title.trim(),
              mode: "code",
              position: isEdit ? component.position : nextPosition,
              sql_template: formB.sql_template,
              code: formB.code,
            }),
          });
          const json = await res.json();
          if (!res.ok) {
            setApiError(json.error ?? "Unknown error");
            return;
          }

          if (isEdit) {
            onUpdated?.(json.component as DashboardComponent);
          } else {
            onCreated?.(json.component as DashboardComponent);
          }
          onClose();
        } catch (err) {
          setApiError(err instanceof Error ? err.message : String(err));
        } finally {
          setSubmitting(false);
        }
      }
    },
    [tab, formA, formAConfigExtra, formB, dashboardId, nextPosition, component, onCreated, onUpdated, onClose]
  );

  // Form Wrapper to intercept JSON parse vs save
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMode === "json") {
      handleLoadJson();
    } else {
      handleSubmit(e);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const sqlAOk = hasFilterPlaceholder(formA.sql_template);
  const sqlBOk = hasFilterPlaceholder(formB.sql_template);

  const canSubmit =
    inputMode === "json"
      ? !submitting && !!jsonText.trim()
      : tab === "declarative"
        ? !submitting && sqlAOk && !!formA.title.trim()
        : !submitting && sqlBOk && !!formB.title.trim() && !!formB.code.trim();

  const buttonText =
    inputMode === "json"
      ? "Parse & Verify JSON"
      : submitting
        ? component
          ? "Saving…"
          : "Adding…"
        : component
          ? "Save changes"
          : tab === "declarative"
            ? "Add chart"
            : "Create chart";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-chart-dialog-title"
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-white/[0.1] bg-[#131525] shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/[0.06]">
          <h2
            id="add-chart-dialog-title"
            className="text-sm font-semibold text-slate-100"
          >
            {component ? "Edit chart component" : "Add chart component"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200 transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Mode tabs (Declarative vs Code) */}
        <div className="flex gap-1 px-6 pt-4 pb-0">
          {(["declarative", "code"] as TabMode[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setApiError(null);
                setJsonSuccessMsg(null);
                if (inputMode === "json") {
                  // Regen template if they change tab while in JSON mode
                  setJsonText("");
                }
              }}
              className={[
                "flex-1 rounded-lg py-1.5 text-xs font-medium transition-all",
                tab === t
                  ? t === "declarative"
                    ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                    : "bg-violet-500/20 text-violet-300 border border-violet-500/40"
                  : "bg-white/[0.03] text-slate-500 border border-white/[0.06] hover:text-slate-300",
              ].join(" ")}
            >
              {t === "declarative" ? "Mode A — Declarative" : "Mode B — Code"}
            </button>
          ))}
        </div>

        {/* Input fields selector (Manual vs JSON Paste) */}
        <div className="flex gap-2 px-6 pt-3 pb-0">
          <button
            type="button"
            onClick={() => {
              setInputMode("manual");
              setApiError(null);
            }}
            className={[
              "rounded-lg px-3 py-1 text-[11px] font-medium border transition-all",
              inputMode === "manual"
                ? "bg-white/[0.08] text-slate-200 border-white/[0.12]"
                : "bg-transparent text-slate-500 border-transparent hover:text-slate-300",
            ].join(" ")}
          >
            Manual fields
          </button>
          <button
            type="button"
            onClick={() => {
              setInputMode("json");
              setApiError(null);
              // Pre-populate with current values to show template schema
              setJsonText(getFormAsJson());
            }}
            className={[
              "rounded-lg px-3 py-1 text-[11px] font-medium border transition-all",
              inputMode === "json"
                ? "bg-white/[0.08] text-slate-200 border-white/[0.12]"
                : "bg-transparent text-slate-500 border-transparent hover:text-slate-300",
            ].join(" ")}
          >
            Paste JSON
          </button>
        </div>

        {/* Mode description */}
        <p className="px-6 pt-3 pb-0 text-[10px] leading-relaxed text-slate-500">
          {inputMode === "json"
            ? "Paste raw JSON matching the expected keys. Submitting will populate manual fields for a visual check."
            : tab === "declarative"
              ? "Pick a chart type, write a SQL template with {{filter}}, and map columns — rendered by Recharts."
              : "Paste a JSX component that receives a data prop (array of row objects already queried and filtered). Must not fetch its own data."}
        </p>

        {/* AI Prompt Helper */}
        <div className="mx-6 mt-3 flex items-center justify-between rounded-xl border border-white/[0.04] bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.03]">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-semibold text-indigo-300">AI Prompt Helper</span>
            <span className="text-[10px] text-slate-400">Copy the prompt to ask an AI for a valid Mode {tab === "declarative" ? "A (Declarative)" : "B (Code)"} JSON.</span>
          </div>
          <button
            type="button"
            onClick={handleCopyPrompt}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-500/10 px-3 py-1.5 text-[11px] font-medium text-indigo-300 border border-indigo-500/20 hover:bg-indigo-500/20 active:scale-95 transition-all"
          >
            {copied ? (
              <>
                <svg className="h-3.5 w-3.5 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                </svg>
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                Copy Prompt
              </>
            )}
          </button>
        </div>

        {/* JSON success message */}
        {jsonSuccessMsg && (
          <div className="mx-6 mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2">
            <p className="text-[11px] font-medium text-emerald-400">{jsonSuccessMsg}</p>
          </div>
        )}

        {/* Form body */}
        <form
          id="add-chart-form"
          onSubmit={handleFormSubmit}
          className="overflow-y-auto px-6 py-5 flex flex-col gap-5"
        >
          {inputMode === "json" ? (
            /* ── JSON paste-in input ─── */
            <div className="flex flex-col gap-1.5">
              <label htmlFor={jsonTextId} className="text-[11px] font-medium uppercase tracking-widest text-slate-500">
                JSON object
              </label>
              <textarea
                id={jsonTextId}
                required
                rows={12}
                spellCheck={false}
                placeholder={
                  tab === "declarative"
                    ? '{\n  "title": "My Chart",\n  "chart_type": "bar",\n  "sql_template": "SELECT x, y FROM sales WHERE {{filter}}",\n  "config": { "xField": "x", "yField": "y" }\n}'
                    : '{\n  "title": "My Code Chart",\n  "sql_template": "SELECT x, y FROM sales WHERE {{filter}}",\n  "code": "export default function Chart({data}) { ... }"\n}'
                }
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                className={`${codeCls} border-white/[0.08] focus:border-indigo-500/60 focus:ring-indigo-500/40`}
              />
            </div>
          ) : tab === "declarative" ? (
            /* ── Mode A manual form ─── */
            <>
              {/* Title */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor={titleAId} className="text-[11px] font-medium uppercase tracking-widest text-slate-500">
                  Title
                </label>
                <input
                  id={titleAId}
                  type="text"
                  required
                  placeholder="e.g. Revenue by category"
                  value={formA.title}
                  onChange={(e) => setA("title", e.target.value)}
                  className={inputCls}
                />
              </div>

              {/* Chart type */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor={typeId} className="text-[11px] font-medium uppercase tracking-widest text-slate-500">
                  Chart type
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(["bar", "line", "pie", "scatter", "waterfall", "gauge", "metric"] as ChartType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setA("chart_type", t)}
                      className={[
                        "rounded-xl border py-2 text-xs font-medium capitalize transition-all text-center",
                        formA.chart_type === t
                          ? "border-indigo-500/60 bg-indigo-500/20 text-indigo-300"
                          : "border-white/[0.06] bg-white/[0.03] text-slate-400 hover:border-white/[0.12] hover:text-slate-200",
                      ].join(" ")}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* SQL template */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor={sqlAId} className="text-[11px] font-medium uppercase tracking-widest text-slate-500">
                  SQL template
                </label>
                <textarea
                  id={sqlAId}
                  required
                  rows={6}
                  spellCheck={false}
                  value={formA.sql_template}
                  onChange={(e) => setA("sql_template", e.target.value)}
                  className={`${codeCls} ${sqlBorderCls(sqlAOk)}`}
                />
                {!sqlAOk && (
                  <p className="text-[10px] text-red-400">
                    Must include <code className="font-mono">{"{{filter}}"}</code> exactly once (SPEC §5).
                  </p>
                )}
                {sqlAOk && (
                  <p className="text-[10px] text-slate-600">
                    ✓ <code className="font-mono">{"{{filter}}"}</code> placeholder present.
                  </p>
                )}
              </div>

              {/* Config fields depending on chart type */}
              {(formA.chart_type === "line" || formA.chart_type === "bar" || formA.chart_type === "scatter") && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={xId} className="text-[11px] font-medium uppercase tracking-widest text-slate-500">X-axis field</label>
                    <input id={xId} type="text" required placeholder="e.g. month" value={formA.xField} onChange={(e) => setA("xField", e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={yId} className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Y-axis field</label>
                    <input id={yId} type="text" required placeholder="e.g. total" value={formA.yField} onChange={(e) => setA("yField", e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5 col-span-2">
                    <label htmlFor="series-field" className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Series field (optional)</label>
                    <input id="series-field" type="text" placeholder="e.g. store" value={formA.seriesField} onChange={(e) => setA("seriesField", e.target.value)} className={inputCls} />
                  </div>
                </div>
              )}

              {formA.chart_type === "pie" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={labelId} className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Label field</label>
                    <input id={labelId} type="text" required placeholder="e.g. category" value={formA.labelField} onChange={(e) => setA("labelField", e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={valueId} className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Value field</label>
                    <input id={valueId} type="text" required placeholder="e.g. total" value={formA.valueField} onChange={(e) => setA("valueField", e.target.value)} className={inputCls} />
                  </div>
                </div>
              )}

              {formA.chart_type === "waterfall" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={labelId} className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Label field</label>
                    <input id={labelId} type="text" required placeholder="e.g. step" value={formA.labelField} onChange={(e) => setA("labelField", e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={valueId} className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Value field</label>
                    <input id={valueId} type="text" required placeholder="e.g. delta" value={formA.valueField} onChange={(e) => setA("valueField", e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5 col-span-2">
                    <label htmlFor="waterfall-total-labels" className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Total Labels (optional, comma-separated)</label>
                    <input id="waterfall-total-labels" type="text" placeholder="e.g. Net Total, Gross Margin" value={formA.waterfallTotalLabels} onChange={(e) => setA("waterfallTotalLabels", e.target.value)} className={inputCls} />
                  </div>
                </div>
              )}

              {formA.chart_type === "gauge" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5 col-span-2">
                    <label htmlFor={valueId} className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Value field</label>
                    <input id={valueId} type="text" required placeholder="e.g. percentage" value={formA.valueField} onChange={(e) => setA("valueField", e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="gauge-min" className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Min value</label>
                    <input id="gauge-min" type="number" required placeholder="0" value={formA.gaugeMin} onChange={(e) => setA("gaugeMin", e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="gauge-max" className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Max value</label>
                    <input id="gauge-max" type="number" required placeholder="100" value={formA.gaugeMax} onChange={(e) => setA("gaugeMax", e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5 col-span-2">
                    <label htmlFor="gauge-thresholds" className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Thresholds JSON (optional)</label>
                    <textarea id="gauge-thresholds" rows={3} placeholder='e.g. [{"value": 30, "color": "red"}, {"value": 70, "color": "yellow"}]' value={formA.gaugeThresholds} onChange={(e) => setA("gaugeThresholds", e.target.value)} className={codeCls} />
                  </div>
                </div>
              )}

              {formA.chart_type === "metric" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={valueId} className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Value field</label>
                    <input id={valueId} type="text" required placeholder="e.g. revenue" value={formA.valueField} onChange={(e) => setA("valueField", e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="metric-label" className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Label text</label>
                    <input id="metric-label" type="text" required placeholder="e.g. Total Revenue" value={formA.metricLabel} onChange={(e) => setA("metricLabel", e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="metric-compare" className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Compare field (optional)</label>
                    <input id="metric-compare" type="text" placeholder="e.g. prior_revenue" value={formA.metricCompareField} onChange={(e) => setA("metricCompareField", e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="metric-format" className="text-[11px] font-medium uppercase tracking-widest text-slate-500">Format</label>
                    <select id="metric-format" value={formA.metricFormat} onChange={(e) => setA("metricFormat", e.target.value as any)} className={`${inputCls} h-[38px] cursor-pointer`}>
                      <option value="number">Number</option>
                      <option value="currency">Currency ($)</option>
                      <option value="percent">Percentage (%)</option>
                    </select>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* ── Mode B manual form ─── */
            <>
              {/* Title */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor={titleBId} className="text-[11px] font-medium uppercase tracking-widest text-slate-500">
                  Title
                </label>
                <input
                  id={titleBId}
                  type="text"
                  required
                  placeholder="e.g. Custom revenue chart"
                  value={formB.title}
                  onChange={(e) => setB("title", e.target.value)}
                  className={inputCls}
                />
              </div>

              {/* SQL template */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor={sqlBId} className="text-[11px] font-medium uppercase tracking-widest text-slate-500">
                  SQL template
                </label>
                <textarea
                  id={sqlBId}
                  required
                  rows={5}
                  spellCheck={false}
                  value={formB.sql_template}
                  onChange={(e) => setB("sql_template", e.target.value)}
                  className={`${codeCls} ${sqlBorderCls(sqlBOk)}`}
                />
                {!sqlBOk && (
                  <p className="text-[10px] text-red-400">
                    Must include <code className="font-mono">{"{{filter}}"}</code> exactly once (SPEC §5).
                  </p>
                )}
                {sqlBOk && (
                  <p className="text-[10px] text-slate-600">
                    ✓ <code className="font-mono">{"{{filter}}"}</code> placeholder present.
                  </p>
                )}
              </div>

              {/* JSX code */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor={codeId} className="text-[11px] font-medium uppercase tracking-widest text-slate-500">
                  Component code (JSX)
                </label>
                <textarea
                  id={codeId}
                  required
                  rows={12}
                  spellCheck={false}
                  placeholder="export default function Chart({ data }) { ... }"
                  value={formB.code}
                  onChange={(e) => setB("code", e.target.value)}
                  className={`${codeCls} border-violet-500/30 focus:border-violet-500/60 focus:ring-violet-500/30`}
                />
                <p className="text-[10px] text-slate-600">
                  The component receives a single prop: <code className="font-mono text-violet-400">data</code> — an array of row objects from DuckDB. Must not fetch its own data (SPEC §7).
                </p>
              </div>
            </>
          )}

          {/* API error */}
          {apiError && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
              <p className="text-xs text-red-400">{apiError}</p>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-xs font-medium text-slate-400 hover:bg-white/[0.07] hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            form="add-chart-form"
            type="submit"
            disabled={!canSubmit}
            className={[
              "rounded-xl px-5 py-2 text-xs font-semibold transition-all",
              !canSubmit
                ? "cursor-not-allowed opacity-40 bg-indigo-500/30 text-indigo-300/50"
                : inputMode === "json"
                  ? "bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white shadow-lg shadow-emerald-500/20"
                  : tab === "declarative"
                    ? "bg-indigo-500 text-white hover:bg-indigo-400 active:scale-[0.98] shadow-lg shadow-indigo-500/20"
                    : "bg-violet-600 text-white hover:bg-violet-500 active:scale-[0.98] shadow-lg shadow-violet-500/20",
            ].join(" ")}
          >
            {buttonText}
          </button>
        </div>
      </div>
    </div>
  );
}

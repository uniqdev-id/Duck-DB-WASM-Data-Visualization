"use client";

/**
 * DeclarativeChart — Mode A renderer (SPEC §6).
 *
 * Switches on chart_type and renders with Recharts 3.8.x, react-gauge-component, or styled metric card.
 * Receives pre-fetched, pre-filtered data — never queries DuckDB itself.
 *
 * Supported types: 'line' | 'bar' | 'pie' | 'scatter' | 'waterfall' | 'gauge' | 'metric'
 */

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  ScatterChart,
  Scatter,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type {
  LineBarConfig,
  PieConfig,
  ScatterConfig,
  WaterfallConfig,
  GaugeConfig,
  MetricConfig,
  ChartConfig,
  QueryRow,
} from "@/types/dashboard";
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";

// Dynamically import react-gauge-component for GaugeChart (SSR disabled)
const GaugeComponent = dynamic(() => import("react-gauge-component"), { ssr: false });

// A curated palette that reads well on dark backgrounds.
const COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#ec4899", // pink
  "#84cc16", // lime
];

// ── Shared axis / tooltip styles ─────────────────────────────────────────────

const axisStyle = { fill: "#94a3b8", fontSize: 11 };
const gridStyle = { stroke: "rgba(148,163,184,0.1)" };

// ── Sub-renderers ────────────────────────────────────────────────────────────

function LineChartView({
  data,
  config,
}: {
  data: QueryRow[];
  config: LineBarConfig;
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" {...gridStyle} />
        <XAxis dataKey={config.xField} tick={axisStyle} tickLine={false} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={60} />
        <Tooltip
          contentStyle={{
            background: "#1e1e2e",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            color: "#e2e8f0",
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
        {config.seriesField ? (
          <Line
            type="monotone"
            dataKey={config.yField}
            stroke={COLORS[0]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5 }}
          />
        ) : (
          <Line
            type="monotone"
            dataKey={config.yField}
            stroke={COLORS[0]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5 }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

function BarChartView({
  data,
  config,
}: {
  data: QueryRow[];
  config: LineBarConfig;
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" {...gridStyle} vertical={false} />
        <XAxis dataKey={config.xField} tick={axisStyle} tickLine={false} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={60} />
        <Tooltip
          contentStyle={{
            background: "#1e1e2e",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            color: "#e2e8f0",
            fontSize: 12,
          }}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
        <Bar dataKey={config.yField} radius={[4, 4, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function PieChartView({
  data,
  config,
}: {
  data: QueryRow[];
  config: PieConfig;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 1. Raw rows returned from the DuckDB query before mapping
  console.log("[PieChartView] Raw data rows returned from query:", data);

  // 2. Resolved labelField and valueField from config, and existence as keys in the first row
  const labelField = config.labelField;
  const valueField = config.valueField;
  const firstRow = data[0] || {};
  const labelExists = firstRow ? labelField in firstRow : false;
  const valueExists = firstRow ? valueField in firstRow : false;
  console.log("[PieChartView] Resolved config fields:", {
    labelField,
    valueField,
    labelExists,
    valueExists,
    firstRowKeys: Object.keys(firstRow),
  });

  // 3. Sum of all values after mapping with valueField, and warning if it's 0 or NaN
  const values = data.map(row => Number(row[valueField]));
  const sum = values.reduce((acc, curr) => acc + (isNaN(curr) ? 0 : curr), 0);
  console.log("[PieChartView] Mapped values:", values);
  console.log("[PieChartView] Sum of mapped values:", sum);
  if (sum === 0 || isNaN(sum)) {
    console.warn(`[PieChartView Warning] valueField '${valueField}' did not resolve to numeric data`);
  }

  // 4. Log the container's measured width/height on render (effect)
  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const style = window.getComputedStyle(containerRef.current);
      console.log("[PieChartView Render] Measured parent width:", rect.width, "height:", rect.height, "style.height:", style.height);
    }
  }, [data]);

  // Map valueField to standard numbers to prevent Recharts from failing on BigInt or String data from DuckDB
  const formattedData = data.map((row) => ({
    ...row,
    [valueField]: Number(row[valueField]) || 0,
    [labelField]: String(row[labelField] ?? ""),
  }));

  return (
    <div ref={containerRef} style={{ width: "100%", height: 280, position: "relative" }}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        onResize={(width, height) => {
          console.log("[PieChartView ResponsiveContainer] Measured size via onResize: width =", width, "height =", height);
        }}
      >
        <PieChart>
          <Pie
            data={formattedData}
            dataKey={valueField}
            nameKey={labelField}
            cx="50%"
            cy="50%"
            outerRadius={100}
            innerRadius={50}
            paddingAngle={2}
          >
            {formattedData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "#1e1e2e",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              color: "#e2e8f0",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function ScatterChartView({
  data,
  config,
}: {
  data: QueryRow[];
  config: ScatterConfig;
}) {
  // If seriesField is specified, group the data.
  let seriesNames: string[] = ["Points"];
  let seriesDataMap: Record<string, QueryRow[]> = { "Points": data };

  if (config.seriesField) {
    seriesDataMap = {};
    data.forEach((row) => {
      const sName = String(row[config.seriesField!] ?? "Points");
      if (!seriesDataMap[sName]) {
        seriesDataMap[sName] = [];
      }
      seriesDataMap[sName].push(row);
    });
    seriesNames = Object.keys(seriesDataMap);
  }

  // Ensure coordinate values are numeric. Recharts Scatter requires numeric x and y values on numeric axes.
  const formattedDataMap = Object.keys(seriesDataMap).reduce((acc, key) => {
    acc[key] = seriesDataMap[key].map(row => ({
      ...row,
      [config.xField]: Number(row[config.xField]) || 0,
      [config.yField]: Number(row[config.yField]) || 0,
    }));
    return acc;
  }, {} as Record<string, any[]>);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" {...gridStyle} />
        <XAxis type="number" dataKey={config.xField} name={config.xField} tick={axisStyle} tickLine={false} />
        <YAxis type="number" dataKey={config.yField} name={config.yField} tick={axisStyle} tickLine={false} axisLine={false} width={60} />
        <Tooltip
          contentStyle={{
            background: "#1e1e2e",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            color: "#e2e8f0",
            fontSize: 12,
          }}
          cursor={{ strokeDasharray: "3 3" }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
        {seriesNames.map((sName, i) => (
          <Scatter
            key={sName}
            name={sName}
            data={formattedDataMap[sName]}
            fill={COLORS[i % COLORS.length]}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function WaterfallChartView({
  data,
  config,
}: {
  data: QueryRow[];
  config: WaterfallConfig;
}) {
  // Client-side cumulative sum transform (as per SPEC §6) using a for loop to avoid closure mutation issues
  const transformed = [];
  let cumulative = 0;
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const label = String(item[config.labelField] || "");
    const val = Number(item[config.valueField]) || 0;
    const isTotal = config.totalLabels?.includes(label) ?? false;
    
    let range: [number, number];
    if (isTotal) {
      range = [0, val];
      cumulative = val; // Anchor running total to this value
    } else {
      const nextCumulative = cumulative + val;
      range = [cumulative, nextCumulative];
      cumulative = nextCumulative;
    }
    
    transformed.push({
      ...item,
      __label: label,
      __val: val,
      __isTotal: isTotal,
      __range: range,
    });
  }

  const tooltipFormatter = (
    _value: unknown,
    _name: string | number,
    props: { payload: { __val: number; __isTotal: boolean } }
  ) => {
    const payload = props.payload;
    const val = payload.__val;
    const formattedVal = new Intl.NumberFormat("en-US").format(val);
    if (payload.__isTotal) {
      return [formattedVal, "Total"];
    }
    return [formattedVal, val >= 0 ? "Increase" : "Decrease"];
  };

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={transformed} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" {...gridStyle} vertical={false} />
        <XAxis dataKey="__label" tick={axisStyle} tickLine={false} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={60} />
        <Tooltip
          contentStyle={{
            background: "#1e1e2e",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            color: "#e2e8f0",
            fontSize: 12,
          }}
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          formatter={tooltipFormatter as any}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
        <Bar dataKey="__range" name="Value">
          {transformed.map((entry, index) => {
            let fill = "#6366f1"; // default total (indigo)
            if (!entry.__isTotal) {
              fill = entry.__val >= 0 ? "#10b981" : "#ef4444"; // emerald vs red
            }
            return <Cell key={`cell-${index}`} fill={fill} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function GaugeChartView({
  data,
  config,
}: {
  data: QueryRow[];
  config: GaugeConfig;
}) {
  const row = data[0] || {};
  const val = Number(row[config.valueField]) || 0;
  
  // Build arc subArcs from thresholds
  const subArcs = config.thresholds?.map((t) => ({
    limit: t.value,
    color: t.color,
    showTick: true,
  })) || [];

  return (
    <div className="flex h-[280px] w-full flex-col items-center justify-center p-4">
      <div className="h-[200px] w-full max-w-[320px]">
        <GaugeComponent
          value={val}
          minValue={config.min}
          maxValue={config.max}
          arc={subArcs.length > 0 ? { subArcs } : undefined}
          labels={{
            valueLabel: {
              style: { fill: "#e2e8f0", textShadow: "none", fontSize: "24px" }
            },
            tickLabels: {
              type: "outer",
              defaultTickValueConfig: {
                style: { fill: "#94a3b8", fontSize: "10px" }
              }
            }
          }}
        />
      </div>
    </div>
  );
}

function MetricChartView({
  data,
  config,
}: {
  data: QueryRow[];
  config: MetricConfig;
}) {
  const row = data[0] || {};
  const currentVal = Number(row[config.valueField]) || 0;
  const compareVal = config.compareField ? Number(row[config.compareField]) : null;

  // Formatting helper
  const formatValue = (val: number, format?: "number" | "currency" | "percent") => {
    if (format === "currency") {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
    }
    if (format === "percent") {
      return new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(val);
    }
    return new Intl.NumberFormat("en-US").format(val);
  };

  const formattedValue = formatValue(currentVal, config.format);

  let deltaPercent = 0;
  if (compareVal !== null && compareVal !== 0) {
    deltaPercent = (currentVal - compareVal) / compareVal;
  }

  return (
    <div className="flex h-[280px] w-full flex-col justify-between p-6">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-widest text-slate-500">
          {config.label}
        </span>
        <span className="text-4xl font-bold tracking-tight text-white mt-4">
          {formattedValue}
        </span>
      </div>

      {compareVal !== null && (
        <div className="flex items-center gap-2 border-t border-white/[0.04] pt-4">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            deltaPercent > 0
              ? "bg-emerald-500/10 text-emerald-400"
              : deltaPercent < 0
              ? "bg-red-500/10 text-red-400"
              : "bg-slate-500/10 text-slate-400"
          }`}>
            <span>
              {deltaPercent > 0 ? "▲" : deltaPercent < 0 ? "▼" : "■"}
            </span>
            <span>
              {new Intl.NumberFormat("en-US", {
                style: "percent",
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
                signDisplay: "always"
              }).format(deltaPercent)}
            </span>
          </span>
          <span className="text-[11px] text-slate-500">
            vs prior period ({formatValue(compareVal, config.format)})
          </span>
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

type DeclarativeChartProps = {
  chartType: "line" | "bar" | "pie" | "scatter" | "waterfall" | "gauge" | "metric";
  config: ChartConfig;
  data: QueryRow[];
};

export function DeclarativeChart({
  chartType,
  config,
  data,
}: DeclarativeChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-slate-500">
        No data returned
      </div>
    );
  }

  switch (chartType) {
    case "line":
      return <LineChartView data={data} config={config as LineBarConfig} />;
    case "bar":
      return <BarChartView data={data} config={config as LineBarConfig} />;
    case "pie":
      return <PieChartView data={data} config={config as PieConfig} />;
    case "scatter":
      return <ScatterChartView data={data} config={config as ScatterConfig} />;
    case "waterfall":
      return <WaterfallChartView data={data} config={config as WaterfallConfig} />;
    case "gauge":
      return <GaugeChartView data={data} config={config as GaugeConfig} />;
    case "metric":
      return <MetricChartView data={data} config={config as MetricConfig} />;
    default:
      return (
        <pre className="overflow-auto p-4 text-xs text-slate-400">
          {JSON.stringify(data.slice(0, 5), null, 2)}
        </pre>
      );
  }
}

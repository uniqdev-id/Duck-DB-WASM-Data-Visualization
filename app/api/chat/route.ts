import { NextRequest } from "next/server";
import { streamText, tool } from "ai";
import { getChatModel } from "@/lib/llm";
import { supabase } from "@/lib/supabase";
import { validateChartDefinition } from "@/lib/validateChartDefinition";
import { z } from "zod/v3";
import fs from "fs";
import path from "path";

function logErrorToFile(context: string, error: any) {
  const logPath = "/Users/annasblackhat/Documents/Experiment/dashboard-experiment/chat_errors.log";
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : "";

  let details = "";
  if (error && typeof error === "object") {
    if ("statusCode" in error) details += `Status Code: ${error.statusCode}\n`;
    if ("responseBody" in error) details += `Response Body: ${error.responseBody}\n`;
    if ("url" in error) details += `URL: ${error.url}\n`;
  }

  const logMessage = `[${new Date().toISOString()}] ${context}: ${errorMessage}\n${details}Stack: ${errorStack}\n\n`;
  try {
    fs.appendFileSync(logPath, logMessage, "utf8");
  } catch (err) {
    console.error("Failed to write to chat_errors.log:", err);
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { messages, dashboardId } = body;

  if (!dashboardId) {
    return new Response("dashboardId is required", { status: 400 });
  }

  try {
    const model = getChatModel();

    const result = streamText({
      model: model as any,
      messages,
      system: `You are an expert dashboard developer assistant.
Your job is to manage the charts on the user's dashboard by calling the appropriate tools.
The dashboard components are stored in Supabase.

DATA SCHEMA — the ONLY table you can query is 'sales'. These are its actual
columns; never reference a column that isn't in this list, and never guess
based on what a "typical" sales table might have:

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

There is no separate products/stores table available to you — 'product_id' and
'store_id' are raw IDs with no name lookup. If the user asks for something "by
product name" or "by store name", tell them only the ID is available unless
they tell you otherwise, rather than inventing a join to a table you don't have.

CRITICAL RULES:
1. Every 'sql_template' MUST query the 'sales' table, using only the columns above.
2. Every 'sql_template' MUST contain the literal substring '{{filter}}' exactly once, inside a WHERE clause. Even if the chart doesn't conceptually need filtering, write "WHERE {{filter}}" and rely on it being replaced with 1=1. Never omit the placeholder.
3. tx_grand_total, item_subtotal, unit_price, unit_price_add, tx_discount, and tx_voucher are stored as integers in minor currency units. Don't divide or multiply them unless the user explicitly asks for a unit conversion — and if you do, say so out loud in your reply, don't do it silently.
4. has_void and qty_voided exist because some transactions are voided/refunded. Unless the user specifies otherwise, ask whether they want voided transactions included or excluded rather than silently picking one — this materially changes totals.
5. Before finalizing any sql_template, check your own work: does every column referenced actually appear in the schema above? Could a JOIN or subquery you've written multiply rows before an aggregation (a fanout), inflating a SUM/COUNT to an implausible value? If you're not joining to anything, this doesn't apply — but if you are, double check the cardinality.
6. In Mode A ('declarative'):
   - 'chart_type' must be one of: 'line', 'bar', 'pie', 'scatter', 'waterfall', 'gauge', 'metric'.
   - 'config' must match the required fields, and every field name in config MUST exactly match a SELECT alias from your own sql_template — never reference a config field that isn't an alias in the query:
     * line, bar, scatter: { xField: string, yField: string, seriesField?: string }
     * pie: { labelField: string, valueField: string }
     * waterfall: { labelField: string, valueField: string, totalLabels?: string[] }
     * gauge: { valueField: string, min: number, max: number }
     * metric: { valueField: string, label: string }
   - For 'gauge' and 'metric', the query must return EXACTLY ONE ROW.
   - Before finalizing, check that chart_type actually fits the data shape — e.g. don't choose 'gauge' or 'metric' for a query that returns multiple rows, don't choose 'waterfall' for data with no natural running-total structure.
7. In Mode B ('code'):
   - Provide the raw React component code as a JSX string in 'code'.
   - The component must receive exactly one prop: 'data' (pre-fetched and filtered row array).
   - Component code must NEVER run its own DuckDB queries or do its own filtering. Only render the given 'data' prop.
8. If the user asks you to edit or delete a chart "by name/title", you MUST call 'listCharts' first to look up its actual ID. Never guess an ID.
9. If 'listCharts' returns multiple possible matching charts, ask the user for clarification rather than picking one.
10. Deletion is a destructive action. The 'deleteChart' tool will request a confirmation UI step on the client side before executing. Simply call the tool when the user requests deletion, and the UI will prompt them.
11. If a tool call fails with a validation error, correct your mistake and automatically retry the tool call rather than apologizing and giving up.
`,
      onError({ error }) {
        console.error("streamText encountered an asynchronous error:", error);
        logErrorToFile("streamText async error", error);
      },
      tools: {
        listCharts: tool({
          description: "Lists all components on the current dashboard (returns IDs, titles, modes, and chart types). Use this to find IDs before editing/deleting.",
          parameters: z.object({
            dummy: z.string().optional().describe("Unused dummy parameter to ensure valid JSON schema structure"),
          }) as any,
          execute: async () => {
            const { data, error } = await supabase
              .from("dashboard_components")
              .select("id, title, mode, chart_type, position")
              .eq("dashboard_id", dashboardId)
              .order("position");

            if (error) {
              return { success: false, error: error.message };
            }
            return { success: true, charts: data };
          },
        }),
        createChart: tool({
          description: "Creates a new chart component on the dashboard. Generates title, mode, sql_template, chart_type, config (declarative), or code (code mode).",
          parameters: z.object({
            title: z.string().describe("Title of the component"),
            mode: z.enum(["declarative", "code"]).describe("Chart mode: declarative or code"),
            sql_template: z.string().describe("DuckDB SQL query containing {{filter}} inside a WHERE clause"),
            chart_type: z.enum(["line", "bar", "pie", "scatter", "waterfall", "gauge", "metric"]).optional().describe("For declarative mode only"),
            config: z.any().optional().describe("Config object for declarative mode only"),
            code: z.string().optional().describe("React component JSX string for code mode only"),
          }) as any,
          execute: async (params) => {
            // Perform shared validation
            const validation = validateChartDefinition(params);
            if (!validation.isValid) {
              return { success: false, error: validation.error };
            }

            // Get next position
            const { data: currentComps } = await supabase
              .from("dashboard_components")
              .select("id")
              .eq("dashboard_id", dashboardId);
            const nextPos = currentComps ? currentComps.length : 0;

            const { data, error } = await supabase
              .from("dashboard_components")
              .insert({
                dashboard_id: dashboardId,
                title: params.title.trim(),
                mode: params.mode,
                position: nextPos,
                sql_template: params.sql_template,
                chart_type: params.chart_type,
                config: params.config,
                code: params.code,
              })
              .select()
              .single();

            if (error) {
              return { success: false, error: error.message };
            }
            return { success: true, component: data };
          },
        }),
        updateChart: tool({
          description: "Updates an existing chart component definition. You must provide the chart UUID (resolved via listCharts).",
          parameters: z.object({
            id: z.string().describe("The UUID of the chart component to update"),
            title: z.string().optional().describe("New title of the component"),
            mode: z.enum(["declarative", "code"]).optional().describe("New mode: declarative or code"),
            sql_template: z.string().optional().describe("New DuckDB SQL query containing {{filter}} inside a WHERE clause"),
            chart_type: z.enum(["line", "bar", "pie", "scatter", "waterfall", "gauge", "metric"]).optional().describe("New chart type for declarative mode"),
            config: z.any().optional().describe("New config object for declarative mode"),
            code: z.string().optional().describe("New React component JSX string for code mode"),
          }) as any,
          execute: async (params) => {
            // Fetch existing record to merge and validate
            const { data: existing, error: fetchErr } = await supabase
              .from("dashboard_components")
              .select("*")
              .eq("id", params.id)
              .single();

            if (fetchErr || !existing) {
              return { success: false, error: "Component not found." };
            }

            const merged = {
              title: params.title !== undefined ? params.title : existing.title,
              mode: params.mode !== undefined ? params.mode : existing.mode,
              sql_template: params.sql_template !== undefined ? params.sql_template : existing.sql_template,
              chart_type: params.chart_type !== undefined ? params.chart_type : existing.chart_type,
              config: params.config !== undefined ? params.config : existing.config,
              code: params.code !== undefined ? params.code : existing.code,
            };

            const validation = validateChartDefinition(merged);
            if (!validation.isValid) {
              return { success: false, error: validation.error };
            }

            const updateData: Record<string, any> = {};
            if (params.title !== undefined) updateData.title = params.title.trim();
            if (params.mode !== undefined) updateData.mode = params.mode;
            if (params.sql_template !== undefined) updateData.sql_template = params.sql_template;
            if (params.chart_type !== undefined) updateData.chart_type = params.chart_type;
            if (params.config !== undefined) updateData.config = params.config;
            if (params.code !== undefined) updateData.code = params.code;
            updateData.updated_at = new Date().toISOString();

            const { data, error } = await supabase
              .from("dashboard_components")
              .update(updateData)
              .eq("id", params.id)
              .select()
              .single();

            if (error) {
              return { success: false, error: error.message };
            }
            return { success: true, component: data };
          },
        }),
        deleteChart: tool({
          description: "Deletes a chart component. Requires UUID (resolved via listCharts). Pauses for client UI confirmation.",
          parameters: z.object({
            id: z.string().describe("The UUID of the chart component to delete"),
          }) as any,
          // No server execution defined. Handled on client side.
        }),
      },
    });

    return result.toDataStreamResponse();
  } catch (err: any) {
    console.error("Fatal Error in Chat API route:", err);
    logErrorToFile("Fatal Error in Chat API route", err);
    return new Response(
      JSON.stringify({ error: err.message || "An unexpected server-side error occurred." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

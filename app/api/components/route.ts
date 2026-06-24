/**
 * POST /api/components
 * Creates a new dashboard_component row in Supabase.
 *
 * Body (JSON):
 *   dashboard_id  string  — required
 *   title         string  — required
 *   mode          "declarative" | "code"  — required (Step 4 only sends "declarative")
 *   position      number  — required
 *   sql_template  string  — must contain {{filter}} exactly once (SPEC §5)
 *   chart_type    string? — e.g. "line" | "bar" | "pie"
 *   config        object? — Mode A config (LineBarConfig | PieConfig)
 *   code          string? — Mode B JSX (Step 5)
 *
 * AGENTS.md rule 1: no DuckDB import here — this is a Route Handler (server-side).
 * AGENTS.md rule 5: only chart *definitions* written to Supabase, never data rows.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { DashboardComponent } from "@/types/dashboard";

export async function POST(req: NextRequest) {
  let body: Partial<DashboardComponent>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { dashboard_id, title, mode, position, sql_template, chart_type, config, code } = body as Record<string, unknown>;

  // ── Validate required fields ──────────────────────────────────────────────
  if (!dashboard_id || typeof dashboard_id !== "string") {
    return NextResponse.json({ error: "dashboard_id is required" }, { status: 400 });
  }
  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (mode !== "declarative" && mode !== "code") {
    return NextResponse.json({ error: "mode must be 'declarative' or 'code'" }, { status: 400 });
  }
  if (typeof sql_template !== "string" || !sql_template.includes("{{filter}}")) {
    return NextResponse.json(
      { error: "sql_template must be a string containing {{filter}} (SPEC §5)" },
      { status: 400 }
    );
  }

  // ── Insert ─────────────────────────────────────────────────────────────────
  const { data, error } = await supabase
    .from("dashboard_components")
    .insert({
      dashboard_id,
      title,
      mode,
      position: typeof position === "number" ? position : 0,
      sql_template,
      ...(chart_type ? { chart_type } : {}),
      ...(config ? { config } : {}),
      ...(code ? { code } : {}),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ component: data }, { status: 201 });
}

/**
 * DELETE /api/components/[id]
 * Deletes a single dashboard_component row by its UUID.
 *
 * AGENTS.md rule 1: no DuckDB import — this is a Route Handler (server-side).
 * AGENTS.md rule 5: only chart *definitions* in Supabase, never data rows.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("dashboard_components")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { title, mode, sql_template, chart_type, config, code } = body;

  // ── Validation ─────────────────────────────────────────────────────────────
  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
  }
  if (mode !== undefined && mode !== "declarative" && mode !== "code") {
    return NextResponse.json({ error: "mode must be 'declarative' or 'code'" }, { status: 400 });
  }
  if (sql_template !== undefined) {
    if (typeof sql_template !== "string" || !sql_template.includes("{{filter}}")) {
      return NextResponse.json(
        { error: "sql_template must contain {{filter}} exactly once (SPEC §5)" },
        { status: 400 }
      );
    }
    const filterCount = (sql_template.match(/\{\{filter\}\}/g) || []).length;
    if (filterCount !== 1) {
      return NextResponse.json(
        { error: "sql_template must contain {{filter}} exactly once (SPEC §5)" },
        { status: 400 }
      );
    }
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  const updateData: Record<string, any> = {};
  if (title !== undefined) updateData.title = title.trim();
  if (mode !== undefined) updateData.mode = mode;
  if (sql_template !== undefined) updateData.sql_template = sql_template;
  
  // Handled conditionally to allow setting/unsetting based on mode
  if (chart_type !== undefined) updateData.chart_type = chart_type;
  if (config !== undefined) updateData.config = config;
  if (code !== undefined) updateData.code = code;
  
  updateData.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("dashboard_components")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ component: data }, { status: 200 });
}

/**
 * DELETE /api/components/[id]
 * Deletes a single dashboard_component row by its UUID.
 *
 * AGENTS.md rule 1: no DuckDB import — this is a Route Handler (server-side).
 * AGENTS.md rule 5: only chart *definitions* in Supabase, never data rows.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { validateChartDefinition } from "@/lib/validateChartDefinition";

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

  // Retrieve the existing component to merge and validate
  const { data: existing, error: fetchErr } = await supabase
    .from("dashboard_components")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Component not found" }, { status: 404 });
  }

  const merged = {
    title: title !== undefined ? title : existing.title,
    mode: mode !== undefined ? mode : existing.mode,
    sql_template: sql_template !== undefined ? sql_template : existing.sql_template,
    chart_type: chart_type !== undefined ? chart_type : existing.chart_type,
    config: config !== undefined ? config : existing.config,
    code: code !== undefined ? code : existing.code,
  };

  const validation = validateChartDefinition(merged);
  if (!validation.isValid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  const updateData: Record<string, any> = {};
  if (title !== undefined) updateData.title = title.trim();
  if (mode !== undefined) updateData.mode = mode;
  if (sql_template !== undefined) updateData.sql_template = sql_template;
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

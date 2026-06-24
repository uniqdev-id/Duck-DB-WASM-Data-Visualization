/**
 * /dashboard — Server Component.
 *
 * Auto-picks the first dashboard (by created_at) and redirects to
 * /dashboard/[id]. This keeps the URL bookmarkable and sets up clean
 * navigation for Step 4 (add/delete dashboards).
 */

import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";

export const metadata = {
  title: "Dashboard | Sales Experiment",
  description: "Auto-redirect to the first available dashboard.",
};

export default async function DashboardIndexPage() {
  const { data, error } = await supabase
    .from("dashboards")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0c0e1a] p-8 text-center">
        <p className="text-sm font-medium text-red-400">
          Could not load dashboards from Supabase
        </p>
        <pre className="max-w-md overflow-auto rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-left text-xs text-red-300/70">
          {error.message}
        </pre>
        <p className="text-xs text-slate-500">
          Check that NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
          are set, and that the schema has been applied.
        </p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-[#0c0e1a] p-8 text-center">
        <p className="text-sm font-medium text-slate-300">
          No dashboards found.
        </p>
        <p className="text-xs text-slate-500">
          Run <code className="text-indigo-400">supabase/schema.sql</code> in
          your Supabase SQL Editor to create the schema and seed data.
        </p>
      </main>
    );
  }

  redirect(`/dashboard/${data.id}`);
}

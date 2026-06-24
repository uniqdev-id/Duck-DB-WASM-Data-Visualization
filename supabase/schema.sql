-- ============================================================
-- Dashboard Experiment — Supabase Schema
-- Run this once in the Supabase SQL Editor.
-- ============================================================

-- 1. dashboards — one row per dashboard configuration
create table if not exists dashboards (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  parquet_url text        not null,
  created_at  timestamptz default now()
);

-- 2. dashboard_components — one row per chart
create table if not exists dashboard_components (
  id                  uuid        primary key default gen_random_uuid(),
  dashboard_id        uuid        not null references dashboards(id) on delete cascade,
  title               text        not null,
  mode                text        not null check (mode in ('declarative', 'code')),
  position            int         not null default 0,
  -- sql_template MUST contain {{filter}} exactly once (see SPEC §5)
  sql_template        text        not null,
  -- declarative-mode fields
  chart_type          text        check (chart_type in ('line', 'bar', 'pie', 'scatter', 'waterfall', 'gauge', 'metric')),
  config              jsonb,
  -- code-mode field (Mode B, Step 5)
  code                text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- ============================================================
-- Seed data
-- Update parquet_url to match your NEXT_PUBLIC_PARQUET_URL.
-- ============================================================

insert into dashboards (name, parquet_url)
values (
  'Sales Dashboard',
  'http://localhost:3000/sales_fact_50k.parquet'
)
on conflict do nothing;

-- Chart 1 — Revenue by Store (bar)
-- Columns used: store_id, item_subtotal
insert into dashboard_components
  (dashboard_id, title, mode, position, sql_template, chart_type, config)
values (
  (select id from dashboards order by created_at limit 1),
  'Revenue by Store (Top 10)',
  'declarative',
  0,
  'SELECT store_id::varchar AS store, ROUND(SUM(item_subtotal), 2) AS revenue FROM sales WHERE {{filter}} GROUP BY 1 ORDER BY 2 DESC LIMIT 10',
  'bar',
  '{"xField": "store", "yField": "revenue"}'
);

-- Chart 2 — Monthly Revenue Trend (line)
-- Columns used: transaction_at, item_subtotal
insert into dashboard_components
  (dashboard_id, title, mode, position, sql_template, chart_type, config)
values (
  (select id from dashboards order by created_at limit 1),
  'Monthly Revenue Trend',
  'declarative',
  1,
  'SELECT date_trunc(''month'', transaction_at::TIMESTAMP)::TEXT AS month, ROUND(SUM(item_subtotal), 2) AS revenue FROM sales WHERE {{filter}} GROUP BY 1 ORDER BY 1',
  'line',
  '{"xField": "month", "yField": "revenue"}'
);

-- Chart 3 — Transaction Volume by Status (bar)
-- Columns used: tx_status, sales_id
insert into dashboard_components
  (dashboard_id, title, mode, position, sql_template, chart_type, config)
values (
  (select id from dashboards order by created_at limit 1),
  'Transaction Volume by Status',
  'declarative',
  2,
  'SELECT tx_status::varchar AS status, COUNT(sales_id) AS transactions FROM sales WHERE {{filter}} GROUP BY 1 ORDER BY 2 DESC',
  'bar',
  '{"xField": "status", "yField": "transactions"}'
);

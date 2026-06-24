/**
 * DuckDB WASM singleton — CLIENT SIDE ONLY.
 *
 * Rules enforced here (from AGENTS.md / SPEC §8):
 *  1. This file must never be imported in a Server Component or API route.
 *  2. `initDuckDB()` is idempotent — it creates the DuckDB instance and
 *     registers the Parquet file as table `sales` exactly once per page load.
 *  3. Callers must only ever run SELECT queries against `sales`. They must
 *     never call `CREATE TABLE` or re-register the Parquet file.
 */

import * as duckdb from "@duckdb/duckdb-wasm";
import { useState, useEffect } from "react";

// ──────────────────────────────────────────────────────────────────────────────
// Singleton state and configuration
// ──────────────────────────────────────────────────────────────────────────────

// Set this flag to true to test direct read_parquet querying instead of importing to an in-memory table.
const TEST_DIRECT_QUERY_MODE = false;

// Gate timing logs behind this constant
const DEBUG_DUCKDB_TIMING = true;

// Helper to format bytes to human readable format
function formatBytes(bytes: number | bigint | null | undefined): string {
  if (bytes === null || bytes === undefined) return "unknown";
  const num = typeof bytes === "bigint" ? Number(bytes) : bytes;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(2)} KB`;
  return `${(num / (1024 * 1024)).toFixed(2)} MB`;
}

let dbInstance: duckdb.AsyncDuckDB | null = null;
let initPromise: Promise<duckdb.AsyncDuckDB> | null = null;

// Global react hook state
let isDuckDbLoading = false;
let isDuckDbReady = false;
let duckDbError: Error | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Initialization
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Returns the shared DuckDB instance, initialising it on the first call.
 * Subsequent calls return the already-initialised instance immediately.
 *
 * The Parquet file is registered as table `sales` exactly once.
 * The URL is read from NEXT_PUBLIC_PARQUET_URL at call time.
 */
export async function initDuckDB(): Promise<duckdb.AsyncDuckDB> {
  // Return cached instance if already ready.
  if (dbInstance) return dbInstance;

  // If initialisation is already in flight, wait for it.
  if (initPromise) return initPromise;

  isDuckDbLoading = true;
  emit();

  const tTotalStart = performance.now();

  initPromise = (async () => {
    try {
      // 1. Select the best available WASM bundle for this browser.
      // We host the DuckDB Wasm files locally in public/duckdb to avoid cross-origin worker creation restrictions.
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const bundles = {
        mvp: {
          mainModule: `${origin}/duckdb/duckdb-mvp.wasm`,
          mainWorker: `${origin}/duckdb/duckdb-browser-mvp.worker.js`,
        },
        eh: {
          mainModule: `${origin}/duckdb/duckdb-eh.wasm`,
          mainWorker: `${origin}/duckdb/duckdb-browser-eh.worker.js`,
        },
        // NOTE: The coi (threaded) bundle is currently disabled because of an upstream DuckDB-Wasm bug
        // where loading dynamic extensions (like 'parquet') in COI mode throws a LinkError due to shared memory mismatch.
        /*
        coi: {
          mainModule: `${origin}/duckdb/duckdb-coi.wasm`,
          mainWorker: `${origin}/duckdb/duckdb-browser-coi.worker.js`,
          pthreadWorker: `${origin}/duckdb/duckdb-browser-coi.pthread.worker.js`,
        },
        */
      };
      const bundle = await duckdb.selectBundle(bundles);

      // 2. Spin up the worker + database.
      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker!}");`], {
          type: "text/javascript",
        })
      );
      const worker = new Worker(workerUrl);
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.DEBUG);
      const db = new duckdb.AsyncDuckDB(logger, worker);

      if (DEBUG_DUCKDB_TIMING) {
        console.log('[duckdb] crossOriginIsolated:', typeof window !== 'undefined' ? window.crossOriginIsolated : 'N/A');
        console.log('[duckdb] hardwareConcurrency:', typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 'N/A');
        console.log("[duckdb] Instantiating WASM module...");
      }
      const tInstantiateStart = performance.now();
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      const tInstantiateEnd = performance.now();
      const instantiateTime = Math.round(tInstantiateEnd - tInstantiateStart);
      if (DEBUG_DUCKDB_TIMING) {
        console.log(`[duckdb] WASM module instantiated in ${instantiateTime}ms`);
      }
      URL.revokeObjectURL(workerUrl);

      // DIAGNOSE 1 — Diagnose bundle selection and cross-origin isolation status
      const isCoi = !!(bundle.mainModule && bundle.mainModule.includes("coi"));
      const isEh = !!(bundle.mainModule && bundle.mainModule.includes("eh"));
      const bundleName = isCoi ? "coi" : (isEh ? "eh" : "mvp");

      if (DEBUG_DUCKDB_TIMING) {
        console.log(`[duckdb] Selected bundle: ${bundleName}`);
        console.log(`[duckdb] navigator.hardwareConcurrency: ${typeof navigator !== "undefined" ? navigator.hardwareConcurrency : "N/A"}`);
        console.log(`[duckdb] crossOriginIsolated: ${typeof window !== "undefined" ? window.crossOriginIsolated : "N/A"}`);
      }

      if (bundleName !== "coi") {
        console.warn(
          `[duckdb] ⚠️ WARNING: Selected bundle is NOT the threaded/coi variant (selected: "${bundleName}"). ` +
          `This usually means cross-origin isolation is not active. ` +
          `crossOriginIsolated is: ${typeof window !== "undefined" ? window.crossOriginIsolated : "N/A"}`
        );
      }

      // 3. Register the Parquet file as table `sales` — exactly once.
      const parquetUrl = process.env.NEXT_PUBLIC_PARQUET_URL;
      if (!parquetUrl) {
        throw new Error(
          "[duckdb] NEXT_PUBLIC_PARQUET_URL is not set. " +
            "Add it to .env.local and restart the dev server."
        );
      }

      const conn = await db.connect();
      let tableLoadTime = 0;
      try {
        // Explicitly set thread count only if we are using a multi-threaded bundle
        if (bundle.pthreadWorker) {
          const targetThreads = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
          if (DEBUG_DUCKDB_TIMING) {
            console.log(`[duckdb] Setting threads TO ${targetThreads}...`);
          }
          await conn.query(`SET threads TO ${targetThreads};`);
          const threadResult = await conn.query("SELECT current_setting('threads') AS threads;");
          const currentThreads = threadResult.toArray()[0]?.toJSON()?.["threads"];
          if (DEBUG_DUCKDB_TIMING) {
            console.log(`[duckdb] Applied threads setting: ${currentThreads}`);
          }
        } else {
          if (DEBUG_DUCKDB_TIMING) {
            console.log("[duckdb] Threaded bundle not active; skipping threads configuration.");
          }
        }
        if (TEST_DIRECT_QUERY_MODE) {
          if (DEBUG_DUCKDB_TIMING) {
            console.log(`[duckdb] [TEST MODE] Querying read_parquet('${parquetUrl}') directly...`);
          }
          const tDirectStart = performance.now();
          const directQueryResult = await conn.query(
            `SELECT tx_status::varchar AS status, COUNT(sales_id) AS transactions FROM read_parquet('${parquetUrl}') WHERE 1=1 GROUP BY 1 ORDER BY 2 DESC`
          );
          const tDirectEnd = performance.now();
          const directQueryTime = Math.round(tDirectEnd - tDirectStart);
          if (DEBUG_DUCKDB_TIMING) {
            console.log(`[duckdb] [TEST MODE] Direct query took ${directQueryTime}ms`);
            console.log(`[duckdb] [TEST MODE] Row count returned from direct query:`, directQueryResult.numRows);
          }

          const totalTime = Math.round(performance.now() - tTotalStart);
          if (DEBUG_DUCKDB_TIMING) {
            console.log(
              `[duckdb] DuckDB ready (TEST MODE) in ${totalTime}ms (instantiate: ${instantiateTime}ms, direct query: ${directQueryTime}ms)`
            );
          }
        } else {
          if (DEBUG_DUCKDB_TIMING) {
            console.log(`[duckdb] Loading Parquet file into in-memory table 'sales' from ${parquetUrl}...`);
            console.log(`[duckdb] Starting fetch for ${parquetUrl}...`);
          }
          const tFetchStart = performance.now();
          const res = await fetch(parquetUrl);
          if (!res.ok) {
            throw new Error(`Failed to fetch Parquet file from ${parquetUrl}: ${res.statusText}`);
          }
          const buffer = await res.arrayBuffer();
          const tFetchEnd = performance.now();
          const fetchTime = Math.round(tFetchEnd - tFetchStart);
          if (DEBUG_DUCKDB_TIMING) {
            console.log(`[duckdb] Parquet file fetched and buffered in ${fetchTime}ms`);
            console.log(`[duckdb] Registering file buffer...`);
          }

          const tRegisterStart = performance.now();
          await db.registerFileBuffer('sales.parquet', new Uint8Array(buffer));
          const tRegisterEnd = performance.now();
          const registerTime = Math.round(tRegisterEnd - tRegisterStart);
          if (DEBUG_DUCKDB_TIMING) {
            console.log(`[duckdb] Parquet file buffer registered in ${registerTime}ms`);
          }

          const tTableLoadStart = performance.now();
          await conn.query(
            `CREATE TABLE IF NOT EXISTS sales AS SELECT * FROM read_parquet('sales.parquet');`
          );
          const tTableLoadEnd = performance.now();
          tableLoadTime = Math.round(tTableLoadEnd - tTableLoadStart);
          if (DEBUG_DUCKDB_TIMING) {
            console.log(`[duckdb] Table \`sales\` loaded in ${tableLoadTime}ms`);
          }

          // Row count query
          const countResult = await conn.query("SELECT count(*) FROM sales;");
          const rowCount = Number(countResult.toArray()[0]?.toJSON()?.["count_star()"] || 0);

          // Database size / memory usage
          let dbSizeStr = "unknown";
          try {
            const dbSizeResult = await conn.query("SELECT database_size, memory_usage FROM pragma_database_size();");
            const sizeRow = dbSizeResult.toArray()[0]?.toJSON();
            if (sizeRow) {
              const dbSize = sizeRow.database_size;
              const memUsage = sizeRow.memory_usage;
              dbSizeStr = `db_size: ${formatBytes(dbSize)}, mem_usage: ${formatBytes(memUsage)}`;
            }
          } catch (err) {
            console.warn("[duckdb] Could not query PRAGMA database_size:", err);
          }

          if (DEBUG_DUCKDB_TIMING) {
            console.log(`[duckdb] ✅ Table \`sales\` ready. Rows: ${rowCount}, Size: ${dbSizeStr}`);
          }

          const totalTime = Math.round(performance.now() - tTotalStart);
          if (DEBUG_DUCKDB_TIMING) {
            console.log(
              `[duckdb] DuckDB ready in ${totalTime}ms (instantiate: ${instantiateTime}ms, fetch: ${fetchTime}ms, register: ${registerTime}ms, table load: ${tableLoadTime}ms)`
            );
          }
        }
      } finally {
        await conn.close();
      }

      dbInstance = db;
      isDuckDbReady = true;
      isDuckDbLoading = false;
      emit();
      return db;
    } catch (err) {
      isDuckDbLoading = false;
      duckDbError = err instanceof Error ? err : new Error(String(err));
      emit();
      throw err;
    }
  })();

  return initPromise;
}

// ──────────────────────────────────────────────────────────────────────────────
// React Hook
// ──────────────────────────────────────────────────────────────────────────────

/**
 * React hook to access DuckDB loading/ready state and query function.
 * Ensures the singleton initialization is triggered if not already in flight/done.
 */
export function useDuckDb() {
  const [loading, setLoading] = useState(isDuckDbLoading);
  const [ready, setReady] = useState(isDuckDbReady);
  const [error, setError] = useState<Error | null>(duckDbError);

  useEffect(() => {
    const handleChange = () => {
      setLoading(isDuckDbLoading);
      setReady(isDuckDbReady);
      setError(duckDbError);
    };
    listeners.add(handleChange);

    // If not ready and not already loading, trigger the singleton init
    if (!isDuckDbReady && !isDuckDbLoading && !duckDbError) {
      isDuckDbLoading = true;
      emit();
      initDuckDB()
        .then(() => {
          isDuckDbReady = true;
          isDuckDbLoading = false;
          emit();
        })
        .catch((err) => {
          duckDbError = err instanceof Error ? err : new Error(String(err));
          isDuckDbLoading = false;
          emit();
        });
    }

    return () => {
      listeners.delete(handleChange);
    };
  }, []);

  return { loading, ready, error, query };
}

// ──────────────────────────────────────────────────────────────────────────────
// Query helper
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Runs a SQL query against the shared DuckDB instance.
 * Automatically initialises DuckDB on the first call.
 *
 * Returns an array of plain JS objects (one per row).
 */
export async function query<T = Record<string, unknown>>(
  sql: string
): Promise<T[]> {
  const db = await initDuckDB();
  const conn = await db.connect();
  try {
    const result = await conn.query(sql);
    // Convert BigInt values (Arrow int64) to Number so React can render them
    // and JSON.stringify doesn't throw. Safe for the row counts / sales amounts
    // in this experiment.
    return result.toArray().map((row) => {
      const obj = row.toJSON() as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [
          k,
          typeof v === "bigint" ? Number(v) : v,
        ])
      );
    }) as T[];
  } finally {
    await conn.close();
  }
}

"use client";

import { useChat } from "ai/react";
import { useEffect, useRef, useState } from "react";
import type { DashboardComponent } from "@/types/dashboard";

type ChatPanelProps = {
  dashboardId: string;
  components: DashboardComponent[];
  onComponentCreated?: (component: DashboardComponent) => void;
  onComponentUpdated?: (component: DashboardComponent) => void;
  onComponentDeleted?: (id: string) => void;
};

export function ChatPanel({
  dashboardId,
  components,
  onComponentCreated,
  onComponentUpdated,
  onComponentDeleted,
}: ChatPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const processedToolCalls = useRef<Set<string>>(new Set());
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    addToolResult,
    isLoading,
    error,
  } = useChat({
    api: "/api/chat",
    body: { dashboardId },
    maxSteps: 5,
  });

  // Automatically scroll to bottom of chat when messages update
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  // Synchronize created/updated charts with dashboard state
  useEffect(() => {
    for (const msg of messages) {
      if (msg.toolInvocations) {
        for (const invocation of msg.toolInvocations) {
          const { toolCallId, toolName, state } = invocation;
          if (state === "result" && !processedToolCalls.current.has(toolCallId)) {
            processedToolCalls.current.add(toolCallId);
            const result = invocation.result as any;
            if (result && result.success) {
              if (toolName === "createChart" && result.component) {
                onComponentCreated?.(result.component);
              } else if (toolName === "updateChart" && result.component) {
                onComponentUpdated?.(result.component);
              }
            }
          }
        }
      }
    }
  }, [messages, onComponentCreated, onComponentUpdated]);

  const handleDeleteConfirm = async (toolCallId: string, id: string) => {
    try {
      const res = await fetch(`/api/components/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Delete failed");
      }
      onComponentDeleted?.(id);
      addToolResult({
        toolCallId,
        result: { success: true, message: "Chart was successfully deleted from dashboard." },
      });
    } catch (err: any) {
      addToolResult({
        toolCallId,
        result: { success: false, error: err.message },
      });
    }
  };

  const handleDeleteCancel = (toolCallId: string) => {
    addToolResult({
      toolCallId,
      result: { success: false, error: "Deletion cancelled by the user." },
    });
  };

  return (
    <>
      {/* ── Chat Panel Toggle Button ── */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-500 active:scale-95 transition-all duration-200 border border-white/10"
        title="Toggle AI Chat Panel"
        aria-label="Toggle AI Chat Panel"
      >
        {isOpen ? (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        )}
      </button>

      {/* ── Chat Sidebar Panel ── */}
      <div
        className={`fixed top-0 right-0 z-40 h-full w-[400px] max-w-full border-l border-white/[0.08] bg-slate-950/90 backdrop-blur-xl shadow-2xl transition-all duration-300 ease-in-out flex flex-col ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b border-white/[0.08] px-6">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
            <h2 className="text-sm font-semibold tracking-tight text-white">Dashboard Assistant</h2>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center p-4">
              <span className="text-3xl">👋</span>
              <p className="mt-2 text-xs font-medium text-slate-200">How can I help you today?</p>
              <p className="mt-1 text-[11px] text-slate-500 max-w-[240px]">
                You can ask me to add new charts, list existing ones, edit configurations, or remove metrics from this dashboard.
              </p>
            </div>
          )}

          {messages.map((message: any) => {
            const isUser = message.role === "user";
            return (
              <div key={message.id} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                <div
                  className={`rounded-2xl px-4 py-2.5 text-xs max-w-[85%] leading-relaxed ${
                    isUser
                      ? "bg-indigo-600 text-white"
                      : "bg-white/[0.04] text-slate-200 border border-white/[0.06]"
                  }`}
                >
                  {message.content}

                  {/* ── Tool Invocations inside message ── */}
                  {message.toolInvocations && message.toolInvocations.length > 0 && (
                    <div className="mt-3 space-y-2 border-t border-white/5 pt-2.5">
                      {message.toolInvocations.map((toolInvocation: any) => {
                        const { toolCallId, toolName, state } = toolInvocation;
                        const args = toolInvocation.args as any;

                        // 1. DELETE CHART (Client Confirm UX)
                        if (toolName === "deleteChart") {
                          const targetChart = components.find((c) => c.id === args.id);
                          const chartTitle = targetChart ? targetChart.title : args.id;

                          if (state === "call") {
                            return (
                              <div key={toolCallId} className="rounded-xl bg-red-950/20 border border-red-500/30 p-3 text-[11px]">
                                <p className="font-semibold text-red-200 mb-2">
                                  Confirm deletion of "{chartTitle}"?
                                </p>
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => handleDeleteCancel(toolCallId)}
                                    className="rounded-lg bg-slate-800 hover:bg-slate-700 px-2 py-1 text-slate-300 font-medium transition-colors"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleDeleteConfirm(toolCallId, args.id)}
                                    className="rounded-lg bg-red-700 hover:bg-red-600 px-2 py-1 text-white font-medium transition-colors shadow-sm"
                                  >
                                    Yes, Delete
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          if (state === "result") {
                            const result = toolInvocation.result as any;
                            return (
                              <div key={toolCallId} className="flex items-center gap-1.5 text-[11px] text-red-400/90 font-medium">
                                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                                {result.success ? "Chart deleted successfully" : `Deletion failed: ${result.error}`}
                              </div>
                            );
                          }
                        }

                        // 2. LIST CHARTS
                        if (toolName === "listCharts") {
                          if (state === "call") {
                            return (
                              <div key={toolCallId} className="flex items-center gap-2 text-[11px] text-slate-500">
                                <span className="h-3 w-3 animate-spin border border-slate-500 border-t-transparent rounded-full" />
                                Retrieving dashboard components...
                              </div>
                            );
                          }
                          if (state === "result") {
                            const result = toolInvocation.result as any;
                            return (
                              <div key={toolCallId} className="rounded-xl bg-slate-900/60 border border-white/5 p-2 text-[11px] text-slate-400 font-mono">
                                {result.success && result.charts ? (
                                  <div className="space-y-1">
                                    <p className="font-semibold text-indigo-400 border-b border-white/5 pb-1 mb-1">Found {result.charts.length} charts:</p>
                                    {result.charts.map((c: any) => (
                                      <p key={c.id} className="truncate">
                                        • {c.title} ({c.mode === "declarative" ? c.chart_type : "code"})
                                      </p>
                                    ))}
                                  </div>
                                ) : (
                                  "Failed to list charts"
                                )}
                              </div>
                            );
                          }
                        }

                        // 3. CREATE CHART
                        if (toolName === "createChart") {
                          if (state === "call") {
                            return (
                              <div key={toolCallId} className="flex items-center gap-2 text-[11px] text-slate-500">
                                <span className="h-3 w-3 animate-spin border border-indigo-500 border-t-transparent rounded-full" />
                                Designing new chart component...
                              </div>
                            );
                          }
                          if (state === "result") {
                            const result = toolInvocation.result as any;
                            return (
                              <div key={toolCallId} className="flex items-center gap-1.5 text-[11px] text-indigo-400 font-medium">
                                <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                                {result.success ? `Created chart: "${result.component?.title}"` : `Creation failed: ${result.error}`}
                              </div>
                            );
                          }
                        }

                        // 4. UPDATE CHART
                        if (toolName === "updateChart") {
                          if (state === "call") {
                            return (
                              <div key={toolCallId} className="flex items-center gap-2 text-[11px] text-slate-500">
                                <span className="h-3 w-3 animate-spin border border-violet-500 border-t-transparent rounded-full" />
                                Updating chart definition...
                              </div>
                            );
                          }
                          if (state === "result") {
                            const result = toolInvocation.result as any;
                            return (
                              <div key={toolCallId} className="flex items-center gap-1.5 text-[11px] text-violet-400 font-medium">
                                <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                                {result.success ? `Updated chart: "${result.component?.title}"` : `Update failed: ${result.error}`}
                              </div>
                            );
                          }
                        }

                        return null;
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {isLoading && (
            <div className="flex items-center gap-2 text-slate-500 text-xs">
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce" />
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.2s]" />
              <span className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.4s]" />
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
              Error connecting to AI assistant: {error.message}. Ensure your LLM API Key is configured.
            </div>
          )}

          <div ref={chatBottomRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="border-t border-white/[0.08] p-4 bg-slate-950/60">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={handleInputChange}
              placeholder="Ask me to build or modify a chart..."
              disabled={isLoading}
              className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:border-indigo-500/60 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="flex items-center justify-center rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-white font-medium text-xs active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

/**
 * validateChartDefinition — extracts shared validation logic (SPEC §15.1 / AGENTS.md rule 5).
 * Called by both the client-side JSON paste-in form and the server-side API endpoints and chat tools.
 */

export type ValidationResult = {
  isValid: boolean;
  error?: string;
};

export function validateChartDefinition(data: any): ValidationResult {
  if (!data || typeof data !== "object") {
    return { isValid: false, error: "Component definition must be a valid JSON object." };
  }

  // 1. Validate Mode
  const mode = data.mode;
  if (mode !== "declarative" && mode !== "code") {
    return { isValid: false, error: "mode must be 'declarative' or 'code'" };
  }

  // 2. Validate Title
  const title = data.title;
  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    return { isValid: false, error: "title must be a non-empty string" };
  }

  // 3. Validate SQL Template and Filter Contract (SPEC §5 / AGENTS.md rule 2)
  const sql = data.sql_template;
  if (typeof sql !== "string") {
    return { isValid: false, error: "sql_template is required and must be a string." };
  }
  if (!sql.includes("{{filter}}")) {
    return { isValid: false, error: "sql_template must contain {{filter}} exactly once (SPEC §5)." };
  }
  const filterCount = (sql.match(/\{\{filter\}\}/g) || []).length;
  if (filterCount !== 1) {
    return { isValid: false, error: "sql_template must contain {{filter}} exactly once (SPEC §5)." };
  }

  // 4. Validate Mode A (Declarative)
  if (mode === "declarative") {
    const chartType = data.chart_type;
    const allowedTypes = ["line", "bar", "pie", "scatter", "waterfall", "gauge", "metric"];
    if (typeof chartType !== "string" || !allowedTypes.includes(chartType)) {
      return {
        isValid: false,
        error: `Invalid chart_type '${chartType}'. Allowed: ${allowedTypes.join(", ")}`,
      };
    }

    const config = data.config;
    if (!config || typeof config !== "object") {
      return { isValid: false, error: "Missing or invalid 'config' object." };
    }

    if (chartType === "line" || chartType === "bar" || chartType === "scatter") {
      if (typeof config.xField !== "string" || !config.xField.trim()) {
        return { isValid: false, error: `${chartType} config requires 'xField' (string).` };
      }
      if (typeof config.yField !== "string" || !config.yField.trim()) {
        return { isValid: false, error: `${chartType} config requires 'yField' (string).` };
      }
    } else if (chartType === "pie" || chartType === "waterfall") {
      if (typeof config.labelField !== "string" || !config.labelField.trim()) {
        return { isValid: false, error: `${chartType} config requires 'labelField' (string).` };
      }
      if (typeof config.valueField !== "string" || !config.valueField.trim()) {
        return { isValid: false, error: `${chartType} config requires 'valueField' (string).` };
      }
    } else if (chartType === "gauge") {
      if (typeof config.valueField !== "string" || !config.valueField.trim()) {
        return { isValid: false, error: "gauge config requires 'valueField' (string)." };
      }
      if (config.min !== undefined && isNaN(Number(config.min))) {
        return { isValid: false, error: "gauge min must be a number." };
      }
      if (config.max !== undefined && isNaN(Number(config.max))) {
        return { isValid: false, error: "gauge max must be a number." };
      }
    } else if (chartType === "metric") {
      if (typeof config.valueField !== "string" || !config.valueField.trim()) {
        return { isValid: false, error: "metric config requires 'valueField' (string)." };
      }
      if (typeof config.label !== "string" || !config.label.trim()) {
        return { isValid: false, error: "metric config requires 'label' (string)." };
      }
    }
  }

  // 5. Validate Mode B (Code)
  if (mode === "code") {
    const code = data.code;
    if (typeof code !== "string" || !code.trim()) {
      return { isValid: false, error: "Missing or invalid 'code' field for Mode B component." };
    }
  }

  return { isValid: true };
}

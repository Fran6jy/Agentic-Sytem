import { mathTools, toolMap } from "./mathTools.js";

const parseNumbers = (input) => (input.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

const extractExpression = (input) => input
  .replace(/what is|calculate|evaluate|please|show me|find/gi, "")
  .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*(-?\d+(?:\.\d+)?)/gi, "(($1 / 100) * $2)")
  .replace(/plus/gi, "+")
  .replace(/minus/gi, "-")
  .replace(/times|multiplied by/gi, "*")
  .replace(/divided by|over/gi, "/")
  .replace(/squared/gi, "^2")
  .replace(/cubed/gi, "^3")
  .replace(/[?!.]$/g, "")
  .trim();

const callTool = async (name, args) => {
  const selectedTool = toolMap.get(name);
  const result = await selectedTool.invoke(args);
  return {
    name,
    args,
    result
  };
};

export async function runDemoMathAgent(question) {
  const normalized = question.toLowerCase();
  let trace;

  if (normalized.includes("differentiate") || normalized.includes("derivative")) {
    const expression = question.replace(/differentiate|derivative of/gi, "").trim();
    trace = [await callTool("differentiate", { expression, variable: "x" })];
  } else if (normalized.includes("solve") && question.includes("=")) {
    const equation = question.replace(/solve/gi, "").replace(/for\s+[a-z]/gi, "").trim();
    trace = [await callTool("solve_linear_equation", { equation, variable: "x" })];
  } else if (normalized.includes("determinant")) {
    const matrixMatch = question.match(/\[\[.*\]\]/);
    const matrix = matrixMatch ? JSON.parse(matrixMatch[0]) : [[4, 2], [1, 3]];
    trace = [await callTool("matrix_determinant", { matrix })];
  } else if (normalized.includes("mean") || normalized.includes("median") || normalized.includes("standard deviation")) {
    trace = [await callTool("statistics_summary", { values: parseNumbers(question) })];
  } else {
    const expression = extractExpression(question);
    trace = [await callTool("evaluate_expression", { expression })];
  }

  const finalResult = trace.at(-1).result;
  return {
    answer: `Result: ${finalResult}`,
    mode: "demo",
    trace,
    toolsAvailable: mathTools.map((mathTool) => mathTool.name)
  };
}

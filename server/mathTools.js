import { tool } from "@langchain/core/tools";
import { derivative, det, evaluate, lusolve, mean, median, simplify, std } from "mathjs";
import { z } from "zod";

const round = (value) => {
  if (typeof value !== "number") return value;
  if (!Number.isFinite(value)) return value.toString();
  return Number.parseFloat(value.toPrecision(12));
};

const toPrintable = (value) => {
  if (Array.isArray(value)) return JSON.stringify(value.map(toPrintable));
  if (value && typeof value.toArray === "function") return JSON.stringify(value.toArray());
  if (value && typeof value.toString === "function" && typeof value !== "number") return value.toString();
  return String(round(value));
};

const binarySchema = z.object({
  a: z.number().describe("The first number."),
  b: z.number().describe("The second number.")
});

export const mathTools = [
  tool(({ a, b }) => String(round(a + b)), {
    name: "add",
    description: "Add two numbers.",
    schema: binarySchema
  }),
  tool(({ a, b }) => String(round(a - b)), {
    name: "subtract",
    description: "Subtract the second number from the first number.",
    schema: binarySchema
  }),
  tool(({ a, b }) => String(round(a * b)), {
    name: "multiply",
    description: "Multiply two numbers.",
    schema: binarySchema
  }),
  tool(({ a, b }) => {
    if (b === 0) throw new Error("Division by zero is undefined.");
    return String(round(a / b));
  }, {
    name: "divide",
    description: "Divide the first number by the second number.",
    schema: binarySchema
  }),
  tool(({ base, exponent }) => String(round(base ** exponent)), {
    name: "power",
    description: "Raise a number to a power.",
    schema: z.object({
      base: z.number().describe("The base number."),
      exponent: z.number().describe("The exponent.")
    })
  }),
  tool(({ expression }) => toPrintable(evaluate(expression)), {
    name: "evaluate_expression",
    description: "Evaluate a mathematical expression, including percentages, roots, trigonometry, and grouped operations.",
    schema: z.object({
      expression: z.string().describe("A mathjs-compatible expression, such as '(18 / 100) * 245 + 37^2'.")
    })
  }),
  tool(({ expression, variable }) => derivative(expression, variable).toString(), {
    name: "differentiate",
    description: "Differentiate an algebraic expression with respect to a variable.",
    schema: z.object({
      expression: z.string().describe("The expression to differentiate, such as 'x^3 + 4x^2 - 7x + 9'."),
      variable: z.string().default("x").describe("The variable to differentiate with respect to.")
    })
  }),
  tool(({ expression }) => simplify(expression).toString(), {
    name: "simplify_expression",
    description: "Simplify an algebraic expression.",
    schema: z.object({
      expression: z.string().describe("The algebraic expression to simplify.")
    })
  }),
  tool(({ equation, variable }) => {
    const [left, right] = equation.split("=");
    if (!left || !right) throw new Error("Equation must include one equals sign.");
    const compiled = simplify(`(${left}) - (${right})`);
    const y0 = compiled.evaluate({ [variable]: 0 });
    const y1 = compiled.evaluate({ [variable]: 1 });
    const slope = y1 - y0;
    if (slope === 0) return y0 === 0 ? "All real values satisfy the equation." : "No solution.";
    return `${variable} = ${round(-y0 / slope)}`;
  }, {
    name: "solve_linear_equation",
    description: "Solve a one-variable linear equation.",
    schema: z.object({
      equation: z.string().describe("Equation with one equals sign, such as '2x + 9 = 33'."),
      variable: z.string().default("x").describe("The variable to solve for.")
    })
  }),
  tool(({ values }) => {
    const sorted = [...values].sort((a, b) => a - b);
    return JSON.stringify({
      count: values.length,
      min: sorted[0],
      max: sorted.at(-1),
      mean: round(mean(values)),
      median: round(median(values)),
      standardDeviation: round(std(values))
    });
  }, {
    name: "statistics_summary",
    description: "Calculate count, min, max, mean, median, and standard deviation for a list of numbers.",
    schema: z.object({
      values: z.array(z.number()).min(1).describe("Numbers to summarize.")
    })
  }),
  tool(({ matrix }) => String(round(det(matrix))), {
    name: "matrix_determinant",
    description: "Calculate the determinant of a square matrix.",
    schema: z.object({
      matrix: z.array(z.array(z.number())).describe("A square numeric matrix.")
    })
  }),
  tool(({ matrix, vector }) => toPrintable(lusolve(matrix, vector)), {
    name: "solve_linear_system",
    description: "Solve a linear system Ax=b for x.",
    schema: z.object({
      matrix: z.array(z.array(z.number())).describe("Coefficient matrix A."),
      vector: z.array(z.number()).describe("Result vector b.")
    })
  })
];

export const toolMap = new Map(mathTools.map((mathTool) => [mathTool.name, mathTool]));

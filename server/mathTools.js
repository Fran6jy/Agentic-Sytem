import { tool } from "@langchain/core/tools";
import {
  ConstantNode,
  OperatorNode,
  compile,
  derivative,
  det,
  evaluate,
  fraction,
  lusolve,
  mean,
  median,
  parse,
  polynomialRoot,
  rationalize,
  simplify,
  std
} from "mathjs";
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

// Turn "lhs = rhs" into a single compiled expression f where f(x) = lhs - rhs.
const equationToExpression = (equation) => {
  const parts = equation.split("=");
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    throw new Error("Equation must include exactly one equals sign.");
  }
  return `(${parts[0]}) - (${parts[1]})`;
};

const realNumber = (value) => {
  if (typeof value === "number") return value;
  if (value && typeof value.re === "number" && Math.abs(value.im ?? 0) < 1e-12) return value.re;
  return Number.NaN;
};

const formatRoot = (value) => {
  if (typeof value === "number") return String(round(value));
  const re = round(value.re ?? 0);
  const im = round(value.im ?? 0);
  if (Math.abs(im) < 1e-12) return String(re);
  return `${re} ${im < 0 ? "-" : "+"} ${Math.abs(im)}i`;
};

// Polynomial coefficients (lowest degree first) if the expression is a
// polynomial in exactly `variable`, otherwise null.
const polynomialCoefficients = (expression, variable) => {
  try {
    // mathjs rationalize chokes on a bare unary minus like "-x^2", so rewrite it as -1 * (...).
    const node = parse(expression).transform((child) => (
      child.type === "OperatorNode" && child.fn === "unaryMinus"
        ? new OperatorNode("*", "multiply", [new ConstantNode(-1), child.args[0]])
        : child
    ));
    const result = rationalize(node, {}, true);
    if (!result.coefficients?.length || result.denominator) return null;
    if (result.variables.length > 1 || (result.variables[0] && result.variables[0] !== variable)) return null;
    return result.coefficients.map(Number);
  } catch {
    return null;
  }
};

// Scan an interval for sign changes (and near-touching zeros), then refine with bisection.
const numericRoots = (expression, variable, from, to) => {
  const f = compile(expression);
  const at = (x) => realNumber(f.evaluate({ [variable]: x }));
  const samples = 6000;
  const step = (to - from) / samples;
  const roots = [];
  const push = (x) => {
    if (roots.every((root) => Math.abs(root - x) > Math.max(1e-6, Math.abs(x) * 1e-8))) roots.push(x);
  };
  let prevX = from;
  let prevY = at(prevX);
  for (let i = 1; i <= samples; i += 1) {
    const x = from + i * step;
    const y = at(x);
    if (Number.isFinite(prevY) && Number.isFinite(y)) {
      if (prevY === 0) push(prevX);
      else if (prevY * y < 0) {
        let lo = prevX;
        let hi = x;
        let loY = prevY;
        for (let k = 0; k < 80; k += 1) {
          const mid = (lo + hi) / 2;
          const midY = at(mid);
          if (loY * midY <= 0) hi = mid;
          else { lo = mid; loY = midY; }
        }
        const root = (lo + hi) / 2;
        // Reject poles, where the sign flips but the function blows up.
        if (Math.abs(at(root)) < 1e-6) push(root);
      }
    }
    prevX = x;
    prevY = y;
  }
  if (Number.isFinite(prevY) && prevY === 0) push(prevX);
  return roots.sort((a, b) => a - b);
};

const simpson = (f, a, b, n = 2000) => {
  const steps = n % 2 === 0 ? n : n + 1;
  const h = (b - a) / steps;
  let sum = f(a) + f(b);
  for (let i = 1; i < steps; i += 1) sum += f(a + i * h) * (i % 2 === 0 ? 2 : 4);
  return (sum * h) / 3;
};

const polynomialAntiderivative = (coefficients, variable) => {
  const terms = coefficients
    .map((coefficient, power) => ({ coefficient: coefficient / (power + 1), power: power + 1 }))
    .filter(({ coefficient }) => coefficient !== 0)
    .reverse()
    .map(({ coefficient, power }) => {
      const exact = fraction(Math.abs(coefficient)).toFraction();
      const term = power === 1 ? variable : `${variable}^${power}`;
      const scale = exact === "1" ? "" : exact.includes("/") ? `(${exact}) ` : `${exact}`;
      return { sign: coefficient < 0 ? "-" : "+", text: `${scale}${term}` };
    });
  if (!terms.length) return "0";
  return terms
    .map(({ sign, text }, index) => (index === 0 ? (sign === "-" ? `-${text}` : text) : ` ${sign} ${text}`))
    .join("");
};

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
    description: "Evaluate a mathematical expression, including percentages, roots, trigonometry, factorials, combinations (combinations(n,k)), logs, and grouped operations.",
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
    const compiled = compile(equationToExpression(equation));
    const at = (x) => realNumber(compiled.evaluate({ [variable]: x }));
    const y0 = at(0);
    const y1 = at(1);
    const y2 = at(2);
    const slope = y1 - y0;
    // A linear function has constant slope; anything else would get a wrong answer here.
    if (![y0, y1, y2].every(Number.isFinite) || Math.abs((y2 - y1) - slope) > 1e-9 * Math.max(1, Math.abs(slope))) {
      throw new Error("This equation is not linear. Use solve_equation instead.");
    }
    if (slope === 0) return y0 === 0 ? "All real values satisfy the equation." : "No solution.";
    return `${variable} = ${round(-y0 / slope)}`;
  }, {
    name: "solve_linear_equation",
    description: "Solve a one-variable LINEAR equation (like 2x + 9 = 33). For quadratics, polynomials, or anything nonlinear use solve_equation.",
    schema: z.object({
      equation: z.string().describe("Equation with one equals sign, such as '2x + 9 = 33'."),
      variable: z.string().default("x").describe("The variable to solve for.")
    })
  }),
  tool(({ equation, variable, searchFrom, searchTo }) => {
    const expression = equationToExpression(equation);
    const coefficients = polynomialCoefficients(expression, variable);
    if (coefficients) {
      while (coefficients.length > 1 && coefficients.at(-1) === 0) coefficients.pop();
      const degree = coefficients.length - 1;
      if (degree === 0) {
        return coefficients[0] === 0 ? "All values satisfy the equation." : "No solution.";
      }
      if (degree <= 3) {
        const roots = polynomialRoot(...coefficients);
        return JSON.stringify({
          method: `exact roots of a degree-${degree} polynomial`,
          solutions: roots.map(formatRoot)
        });
      }
    }
    const roots = numericRoots(expression, variable, searchFrom, searchTo);
    return JSON.stringify({
      method: `numeric root search on [${searchFrom}, ${searchTo}]`,
      solutions: roots.length ? roots.map((root) => String(round(Number(root.toPrecision(10))))) : [],
      note: roots.length ? undefined : "No real roots found in the search interval."
    });
  }, {
    name: "solve_equation",
    description: "Solve any one-variable equation: quadratics, cubics (exact, including complex roots), higher polynomials, trig, exponential, or rational equations (numeric real roots).",
    schema: z.object({
      equation: z.string().describe("Equation with one equals sign, such as 'x^2 - 5x + 6 = 0' or 'sin(x) = 0.5'."),
      variable: z.string().default("x").describe("The variable to solve for."),
      searchFrom: z.number().default(-100).describe("Lower bound for numeric root search."),
      searchTo: z.number().default(100).describe("Upper bound for numeric root search.")
    })
  }),
  tool(({ expression, variable, lower, upper }) => {
    const hasBounds = typeof lower === "number" && typeof upper === "number";
    const coefficients = polynomialCoefficients(expression, variable);
    const antiderivative = coefficients ? polynomialAntiderivative(coefficients, variable) : null;
    if (!hasBounds) {
      if (!antiderivative) throw new Error("Symbolic antiderivatives are only supported for polynomials. Provide lower and upper bounds for a numeric definite integral.");
      return `${antiderivative} + C`;
    }
    const f = compile(expression);
    const value = simpson((x) => realNumber(f.evaluate({ [variable]: x })), lower, upper);
    if (!Number.isFinite(value)) throw new Error("The integral diverges or the function is undefined on the interval.");
    return JSON.stringify({
      definiteIntegral: round(Number(value.toPrecision(10))),
      antiderivative: antiderivative ? `${antiderivative} + C` : undefined
    });
  }, {
    name: "integrate",
    description: "Integrate an expression. With lower and upper bounds returns the definite integral (any continuous function). Without bounds returns an antiderivative (polynomials only).",
    schema: z.object({
      expression: z.string().describe("The integrand, such as 'x^2 + 3x' or 'sin(x)'."),
      variable: z.string().default("x").describe("Integration variable."),
      lower: z.number().optional().describe("Lower bound for a definite integral."),
      upper: z.number().optional().describe("Upper bound for a definite integral.")
    })
  }),
  tool(({ expression, variable, approaching }) => {
    const f = compile(expression);
    const at = (x) => realNumber(f.evaluate({ [variable]: x }));
    const target = approaching === "infinity" ? Infinity : approaching === "-infinity" ? -Infinity : Number(approaching);
    if (Number.isNaN(target)) throw new Error("approaching must be a number, 'infinity', or '-infinity'.");
    const estimate = (side) => {
      const values = [1e-3, 1e-5, 1e-7].map((h) => {
        if (target === Infinity) return at(1 / h);
        if (target === -Infinity) return at(-1 / h);
        return at(target + side * h);
      });
      const last = values.at(-1);
      if (!Number.isFinite(last)) return last;
      if (Math.abs(last) > 1e6 && Math.abs(values[2]) > Math.abs(values[1])) return Math.sign(last) * Infinity;
      return round(Number(last.toPrecision(8)));
    };
    const show = (value) => (Number.isFinite(value) ? value : String(value));
    const left = estimate(-1);
    const right = estimate(1);
    if (!Number.isFinite(target)) return JSON.stringify({ limit: show(left) });
    return JSON.stringify(left === right
      ? { limit: show(left) }
      : { limit: "does not exist (one-sided limits differ)", leftLimit: show(left), rightLimit: show(right) });
  }, {
    name: "limit",
    description: "Numerically estimate the limit of an expression as the variable approaches a point, 'infinity', or '-infinity'. Reports one-sided limits when they differ.",
    schema: z.object({
      expression: z.string().describe("Expression such as 'sin(x)/x' or '(1 + 1/x)^x'."),
      variable: z.string().default("x"),
      approaching: z.string().describe("A number like '0', or 'infinity' / '-infinity'.")
    })
  }),
  tool(({ value, from, to }) => {
    const result = evaluate(`${value} ${from} to ${to}`);
    return result.format({ precision: 10 });
  }, {
    name: "convert_units",
    description: "Convert between units (length, mass, time, temperature, speed, area, volume, energy, and more).",
    schema: z.object({
      value: z.number(),
      from: z.string().describe("Source unit, such as 'km', 'lb', 'degF', 'mph'."),
      to: z.string().describe("Target unit, such as 'mile', 'kg', 'degC', 'm/s'.")
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
    description: "Calculate count, min, max, mean, median, and sample standard deviation for a list of numbers.",
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
  }),
  tool(({ expression }) => {
    const value = evaluate(expression);
    const re = typeof value === "number" ? value : value.re ?? 0;
    const im = typeof value === "number" ? 0 : value.im ?? 0;
    const reR = round(re);
    const imR = round(im);
    const form = imR === 0
      ? `${reR}`
      : `${reR} ${imR < 0 ? "-" : "+"} ${Math.abs(imR)}i`;
    return JSON.stringify({
      result: form,
      real: reR,
      imaginary: imR,
      modulus: round(Math.hypot(re, im)),
      argumentRadians: round(Math.atan2(im, re))
    });
  }, {
    name: "complex_arithmetic",
    description: "Evaluate a complex-number expression that uses 'i' as the imaginary unit. Returns the result in a + bi form along with its modulus and argument. Use for adding, multiplying, dividing, or taking powers and magnitudes of complex numbers with concrete numeric values.",
    schema: z.object({
      expression: z.string().describe("A mathjs complex expression, such as '(3 + 2i) / (1 - 2i)' or 'abs(5 + 12i)'.")
    })
  }),
  tool(({ expressions, xMin, xMax }) => {
    // Validate now so the UI never receives an expression it can't draw.
    expressions.forEach((expression) => parse(expression));
    return JSON.stringify({ plotted: expressions, xMin, xMax });
  }, {
    name: "plot_function",
    description: "Draw one or more functions of x on the interactive graph shown to the user. Call this whenever a function, equation, derivative, or integral is involved so the user can see it.",
    schema: z.object({
      expressions: z.array(z.string()).min(1).max(4).describe("Functions of x, such as ['x^2 - 4', '2x']."),
      xMin: z.number().default(-10),
      xMax: z.number().default(10)
    })
  })
];

export const toolMap = new Map(mathTools.map((mathTool) => [mathTool.name, mathTool]));

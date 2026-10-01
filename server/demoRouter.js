import { mathTools, toolMap } from "./mathTools.js";

const parseNumbers = (input) => (input.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

const extractExpression = (input) => input
  .replace(/\b(what is|what's|calculate|evaluate|please|show me|find|compute)\b/gi, "")
  .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*(-?\d+(?:\.\d+)?)/gi, "(($1 / 100) * $2)")
  .replace(/\bplus\b/gi, "+")
  .replace(/\bminus\b/gi, "-")
  .replace(/\b(times|multiplied by)\b/gi, "*")
  .replace(/\b(divided by|over)\b/gi, "/")
  .replace(/\bsquared\b/gi, "^2")
  .replace(/\bcubed\b/gi, "^3")
  .replace(/[?!.]+\s*$/g, "")
  .trim();

const callTool = async (name, args) => {
  const selectedTool = toolMap.get(name);
  try {
    return { name, args, result: await selectedTool.invoke(args) };
  } catch (error) {
    return { name, args, result: `Error: ${error instanceof Error ? error.message : "tool failed"}`, failed: true };
  }
};

const cleanQuestion = (question, words) => question.replace(words, "").replace(/[?]+\s*$/g, "").trim();

// Returns { trace, steps, plot } for the question, mirroring the live agent's output shape.
const route = async (question) => {
  const normalized = question.toLowerCase();

  if (/differentiate|derivative/.test(normalized)) {
    const expression = cleanQuestion(question, /differentiate|(the\s+)?derivative\s+of|find|with respect to\s+x/gi);
    const step = await callTool("differentiate", { expression, variable: "x" });
    return {
      trace: [step],
      steps: [
        `Apply the power rule term by term: \\(\\frac{d}{dx} x^n = n x^{n-1}\\).`,
        `Constants vanish, and each coefficient stays in front.`,
        `Combine the terms to get \\(${step.result}\\).`
      ],
      plot: step.failed ? undefined : { expressions: [expression, String(step.result)], xMin: -10, xMax: 10 }
    };
  }

  if (/integrate|integral|antiderivative/.test(normalized)) {
    const bounds = question.match(/from\s+(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)/i);
    const expression = cleanQuestion(
      question.replace(/from\s+-?\d+(?:\.\d+)?\s+to\s+-?\d+(?:\.\d+)?/i, ""),
      /integrate|(the\s+)?(integral|antiderivative)\s+of|find|d\s*x\b/gi
    );
    const args = bounds
      ? { expression, variable: "x", lower: Number(bounds[1]), upper: Number(bounds[2]) }
      : { expression, variable: "x" };
    const step = await callTool("integrate", args);
    return {
      trace: [step],
      steps: bounds
        ? [
          `The definite integral is the signed area under \\(${expression}\\) between \\(x=${bounds[1]}\\) and \\(x=${bounds[2]}\\).`,
          `Evaluate it (numerically with Simpson's rule).`,
          `Result: ${prettyResult(step)}.`
        ]
        : [
          `Use the reverse power rule: \\(\\int x^n\\,dx = \\frac{x^{n+1}}{n+1}\\).`,
          `Apply it to every term and add the constant \\(C\\).`
        ],
      plot: step.failed ? undefined : {
        expressions: [expression],
        xMin: bounds ? Math.min(Number(bounds[1]), Number(bounds[2])) - 2 : -10,
        xMax: bounds ? Math.max(Number(bounds[1]), Number(bounds[2])) + 2 : 10,
        shade: bounds ? { from: Number(bounds[1]), to: Number(bounds[2]) } : undefined
      }
    };
  }

  if (/\blimit\b|\blim\b|approaches|goes to|tends to/.test(normalized)) {
    const target = question.match(/(?:approaches|→|->|goes to|tends to|to)\s*(-?\s*(?:infinity|inf|∞)|-?\d+(?:\.\d+)?)/i)?.[1]?.replace(/\s+/g, "") ?? "0";
    const approaching = /inf|∞/.test(target) ? (target.startsWith("-") ? "-infinity" : "infinity") : target;
    const expression = (question.match(/of\s+(.+?)\s+(?:as|when)\s/i)?.[1]
      ?? question.match(/(?:is|what's)\s+(.+?)\s+(?:as|when)\s/i)?.[1]
      ?? "").replace(/^the\s+limit\s+of\s+/i, "").trim();
    const step = await callTool("limit", { expression, variable: "x", approaching });
    let limitValue = step.result;
    try { limitValue = JSON.parse(step.result).limit; } catch { /* keep raw */ }
    return {
      trace: [step],
      steps: [
        `Plug in values of \\(x\\) closer and closer to ${approaching} from both sides.`,
        `The outputs settle toward \\(${limitValue}\\), so that's the limit.`
      ],
      plot: step.failed ? undefined : { expressions: [expression], xMin: -10, xMax: 10 },
      pretty: String(limitValue)
    };
  }

  const conversion = question.match(/(-?\d+(?:\.\d+)?)\s*([a-z°/]+)\s.*?\b(?:to|in|into)\s+([a-z°/]+)/i);
  if (/convert|how many|\bin\b.*\?|\bto\b/.test(normalized) && conversion) {
    const alias = { kilometres: "km", kilometers: "km", kilometre: "km", kilometer: "km", miles: "mile", metres: "m", meters: "m", feet: "ft", foot: "ft", inches: "inch", pounds: "lb", kilograms: "kg", celsius: "degC", fahrenheit: "degF", "°c": "degC", "°f": "degF" };
    const unit = (name) => alias[name.toLowerCase()] ?? name;
    const step = await callTool("convert_units", { value: Number(conversion[1]), from: unit(conversion[2]), to: unit(conversion[3]) });
    if (!step.failed) {
      return { trace: [step], steps: [`Multiply by the conversion factor between ${unit(conversion[2])} and ${unit(conversion[3])}.`] };
    }
  }

  if (/solve/.test(normalized) && question.includes("=")) {
    const variable = question.match(/for\s+([a-z])\b/i)?.[1] ?? "x";
    const equation = cleanQuestion(question, /solve|for\s+[a-z]\b/gi);
    let step = await callTool("solve_linear_equation", { equation, variable });
    if (step.failed) step = await callTool("solve_equation", { equation, variable });
    const [left, right] = equation.split("=");
    return {
      trace: [step],
      steps: [
        `Move everything to one side so the equation reads \\((${left.trim()}) - (${right.trim()}) = 0\\).`,
        `Find the value(s) of \\(${variable}\\) that make that expression zero.`,
        `Solution: ${prettyResult(step)}. Where the two graphs cross is the answer.`
      ],
      plot: variable === "x" ? { expressions: [left.trim(), right.trim()], xMin: -10, xMax: 10 } : undefined
    };
  }

  if (/determinant/.test(normalized)) {
    let matrix = [[4, 2], [1, 3]];
    const matrixMatch = question.match(/\[\[.*\]/);
    if (matrixMatch) {
      try {
        matrix = JSON.parse(matrixMatch[0]);
      } catch {
        return { trace: [{ name: "matrix_determinant", args: {}, result: "Error: could not read that matrix. Use a form like [[4, 2], [1, 3]].", failed: true }], steps: [] };
      }
    }
    const step = await callTool("matrix_determinant", { matrix });
    return {
      trace: [step],
      steps: matrix.length === 2
        ? [`For a 2×2 matrix, \\(\\det = ad - bc\\).`, `Here that's \\(${matrix[0][0]}\\cdot${matrix[1][1]} - ${matrix[0][1]}\\cdot${matrix[1][0]} = ${step.result}\\).`]
        : [`Expand the determinant along a row (mathjs uses LU decomposition).`, `Result: ${step.result}.`]
    };
  }

  if (/mean|median|standard deviation|average/.test(normalized)) {
    const values = parseNumbers(question);
    const step = await callTool("statistics_summary", { values });
    return {
      trace: [step],
      steps: [
        `Sort the ${values.length} values and add them up.`,
        `Mean = sum ÷ count; median = the middle value once sorted.`,
        `Standard deviation measures the typical distance from the mean.`
      ]
    };
  }

  const expression = extractExpression(question);
  const step = await callTool("evaluate_expression", { expression });
  return {
    trace: [step],
    steps: [`Translate the words into math: \\(${expression.replace(/\*/g, "\\times ")}\\).`, `Follow order of operations to get ${step.result}.`]
  };
};

// Tool results are JSON for the model; turn them into something a person wants to read.
const prettyResult = ({ name, args, result }) => {
  let data;
  try {
    data = JSON.parse(result);
  } catch {
    return result;
  }
  if (name === "solve_equation") {
    const variable = args.variable ?? "x";
    return data.solutions.length
      ? data.solutions.map((solution) => `\\(${variable} = ${solution}\\)`).join(" or ")
      : "No real solutions";
  }
  if (name === "integrate") return `\\(${data.definiteIntegral}\\)`;
  if (name === "statistics_summary") {
    return `mean ${data.mean}, median ${data.median}, standard deviation ≈ ${data.standardDeviation} (n = ${data.count}, range ${data.min} to ${data.max})`;
  }
  return result;
};

export async function runDemoMathAgent(question) {
  const { trace, steps, plot, pretty } = await route(question);
  const finalStep = trace.at(-1);
  const answer = finalStep.failed
    ? `**Answer:** I couldn't work that one out in demo mode.\n\n${finalStep.result.replace(/^Error:\s*/, "")}`
    : [
      `**Answer:** ${pretty ?? prettyResult(finalStep)}`,
      steps.length ? `### Steps\n${steps.map((text, index) => `${index + 1}. ${text}`).join("\n")}` : ""
    ].filter(Boolean).join("\n\n");

  return {
    answer,
    mode: "demo",
    trace,
    plot,
    toolsAvailable: mathTools.map((mathTool) => mathTool.name)
  };
}

import cors from "cors";
import "dotenv/config";
import express from "express";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { mathTools, toolMap } from "./mathTools.js";
import { runDemoMathAgent } from "./demoRouter.js";

const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
// OpenRouter keys start with sk-or-; without this they'd be sent to api.openai.com and 401.
const baseURL = process.env.OPENAI_BASE_URL
  || process.env.OPENROUTER_BASE_URL
  || (apiKey?.startsWith("sk-or-") ? "https://openrouter.ai/api/v1" : undefined);
// Free OpenRouter models get retired often, so each setting is a comma-separated
// fallback chain: the first model that responds wins.
const parseModels = (value, fallback) => (value || fallback).split(",").map((name) => name.trim()).filter(Boolean);
const textModels = parseModels(
  process.env.OPENAI_MODEL,
  "nvidia/nemotron-3-super-120b-a12b:free,qwen/qwen3.8-27b:free,google/gemma-4-31b-it:free"
);
const visionModels = parseModels(
  process.env.OPENAI_VISION_MODEL,
  "qwen/qwen3.8-27b:free,google/gemma-4-31b-it:free"
);
const modelName = textModels[0];
const openRouterHeaders = baseURL?.includes("openrouter.ai")
  ? {
      "HTTP-Referer": process.env.OPENROUTER_APP_URL || "https://github.com/Fran6jy/Agentic-Sytem",
      "X-Title": process.env.OPENROUTER_APP_NAME || "Chalk Lab AI Math Tutor"
    }
  : undefined;

const app = express();

// Lock CORS to known origins so other sites can't spend the API key.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : { origin: false }));
app.use(express.json({ limit: "6mb" }));

// Minimal per-IP sliding-window limiter; keeps a public deployment from draining credits.
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE || 20);
const hits = new Map();
const rateLimit = (request, response, next) => {
  const key = request.headers["x-forwarded-for"]?.split(",")[0].trim() || request.ip || "unknown";
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((time) => now - time < 60_000);
  if (recent.length >= RATE_LIMIT) {
    response.status(429).json({ error: "Easy there, speedy! Too many questions in a minute. Take a breath and try again shortly." });
    return;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  next();
};

const systemPrompt = `You are an expert AI Math Assistant.
Use the provided tools for every calculation instead of mental arithmetic.
For equations use solve_linear_equation only when the equation is linear; otherwise use solve_equation.
Whenever the problem involves a function of x (equations, derivatives, integrals, limits, curves), also call plot_function so the student can see it.
Read an "x" written between two plain numbers (like "5 x 5") as multiplication, not a variable.
Do not mention tool names in your answer; the interface already shows them.

Always format your reply exactly like this:
**Answer:** <the final answer in one line, LaTeX allowed>

### Steps
1. <first short step, like a friendly tutor would explain it>
2. <next step>
(3 to 6 steps; each step one or two sentences, use LaTeX with \\( \\) for math)

### Why it works
<one or two sentences of intuition>

If the question offers answer options (multiple choice), say which option matches in the Answer line.`;

const visionPrompt = `You are an OCR transcriber, not a solver.
Reproduce ONLY the math problem exactly as printed in the image.
Preserve numbers, operators, exponents (use ^), fractions, matrices, and part labels like (a)/(b).
Do NOT solve it. Do NOT show any working, steps, reasoning, or final answer.
Output just the question text and nothing else.`;

const makeModel = (model, options = {}) => {
  const chat = new ChatOpenAI({
    apiKey,
    model,
    temperature: options.temperature ?? 0.1,
    // Fail fast and move to the next model instead of LangChain's long 429 backoff.
    maxRetries: 0,
    timeout: Number(process.env.MODEL_TIMEOUT_MS || 60_000),
    configuration: {
      baseURL,
      defaultHeaders: openRouterHeaders
    }
  });
  return options.tools ? chat.bindTools(options.tools) : chat;
};

// Errors worth trying the next model for: retired/unknown model, rate limit, provider outage.
const isModelUnavailable = (error) => [400, 404, 408, 429, 500, 502, 503, 504].includes(error?.status ?? error?.response?.status)
  || /model|unavailable|not found|rate|timed? ?out|abort|connection/i.test(`${error?.name} ${error?.message}`)
  // Some free providers return an empty choices array, which LangChain surfaces as a TypeError.
  || (error instanceof TypeError && /reading 'message'/.test(error.message));

// Try each model in order, starting with whichever answered last time.
const lastWorking = new Map();
const invokeWithFallback = async (models, messages, options = {}) => {
  const preferred = lastWorking.get(models);
  const ordered = preferred ? [preferred, ...models.filter((name) => name !== preferred)] : models;
  let lastError;
  for (const name of ordered) {
    try {
      const response = await makeModel(name, options).invoke(messages);
      lastWorking.set(models, name);
      return { response, name };
    } catch (error) {
      lastError = error;
      if (!isModelUnavailable(error)) throw error;
      console.warn(`model ${name} unavailable (${error?.status ?? "?"}), trying next`);
    }
  }
  throw lastError;
};

const extractProblemFromImage = async (image, question) => {
  const instruction = question
    ? `Transcribe the math problem in this image. Extra context from the user: ${question}`
    : "Transcribe the math problem in this image.";
  const { response } = await invokeWithFallback(visionModels, [
    new SystemMessage(visionPrompt),
    new HumanMessage({
      content: [
        { type: "text", text: instruction },
        { type: "image_url", image_url: { url: image } }
      ]
    })
  ], { temperature: 0 });
  return String(response.content || "").trim();
};

// Build graph data for the UI from plot_function calls, or infer it from calculus tools.
export const plotFromTrace = (trace) => {
  const explicit = trace.filter((step) => step.name === "plot_function" && !step.failed).at(-1);
  if (explicit) {
    return {
      expressions: explicit.args.expressions,
      xMin: explicit.args.xMin ?? -10,
      xMax: explicit.args.xMax ?? 10
    };
  }
  const derivativeStep = trace.find((step) => step.name === "differentiate" && !step.failed);
  if (derivativeStep && (derivativeStep.args.variable ?? "x") === "x") {
    return { expressions: [derivativeStep.args.expression, String(derivativeStep.result)], xMin: -10, xMax: 10 };
  }
  const solveStep = trace.find((step) => ["solve_equation", "solve_linear_equation"].includes(step.name) && !step.failed);
  if (solveStep && (solveStep.args.variable ?? "x") === "x") {
    const [left, right] = solveStep.args.equation.split("=");
    return { expressions: [left.trim(), right.trim()], xMin: -10, xMax: 10 };
  }
  const integralStep = trace.find((step) => step.name === "integrate" && !step.failed);
  if (integralStep && (integralStep.args.variable ?? "x") === "x") {
    const { lower, upper } = integralStep.args;
    const hasBounds = typeof lower === "number" && typeof upper === "number";
    const pad = hasBounds ? Math.max(1, (upper - lower) * 0.5) : 0;
    return {
      expressions: [integralStep.args.expression],
      xMin: hasBounds ? lower - pad : -10,
      xMax: hasBounds ? upper + pad : 10,
      shade: hasBounds ? { from: lower, to: upper } : undefined
    };
  }
  return undefined;
};

const runLangChainAgent = async (question) => {
  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(question)
  ];

  const trace = [];
  const maxRounds = 6;
  let { response, name: activeModel } = await invokeWithFallback(textModels, messages, { tools: mathTools });
  messages.push(response);

  // Keep executing tool calls until the model answers in text;
  // multi-step problems often need several rounds of calculations.
  for (let round = 0; round < maxRounds && response.tool_calls?.length; round += 1) {
    for (const toolCall of response.tool_calls) {
      const selectedTool = toolMap.get(toolCall.name);
      let result;
      let failed = false;
      if (!selectedTool) {
        failed = true;
        result = `Error: unknown tool "${toolCall.name}".`;
      } else {
        try {
          result = await selectedTool.invoke(toolCall.args);
        } catch (toolError) {
          failed = true;
          result = `Error: ${toolError instanceof Error ? toolError.message : "tool failed"}. Try a different approach or solve it directly.`;
        }
      }
      trace.push({
        name: toolCall.name,
        args: toolCall.args,
        result,
        failed
      });
      messages.push(new ToolMessage({
        content: String(result),
        name: toolCall.name,
        tool_call_id: toolCall.id
      }));
    }
    ({ response, name: activeModel } = await invokeWithFallback(textModels, messages, { tools: mathTools }));
    messages.push(response);
  }

  let answer = typeof response.content === "string"
    ? response.content.trim()
    : String(response.content ?? "").trim();

  // If the model ran out of rounds (or returned empty text), force a summary.
  if (!answer) {
    messages.push(new HumanMessage(
      "Using the tool results above, state the final answer now in plain text. Do not call any more tools."
    ));
    const { response: summary } = await invokeWithFallback(textModels, messages);
    answer = typeof summary.content === "string"
      ? summary.content.trim()
      : String(summary.content ?? "").trim();
  }

  return {
    answer: answer || "The assistant could not produce an answer for that one. Please try rephrasing.",
    mode: "langchain",
    model: activeModel,
    trace,
    plot: plotFromTrace(trace),
    toolsAvailable: mathTools.map((mathTool) => mathTool.name)
  };
};

// The UI shows real notation (x², √, π, ×); the tools need mathjs syntax.
const SUPERSCRIPTS = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-" };
export const normalizeNotation = (text) => text
  .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (run) => `^${run.length > 1 ? `(${[...run].map((c) => SUPERSCRIPTS[c]).join("")})` : SUPERSCRIPTS[run]}`)
  .replace(/√/g, "sqrt")
  .replace(/π/g, "pi")
  // "5 x 5" or "5 x5" means times; "5x" with no gap stays a variable term.
  .replace(/(\d)\s+x\s*(?=\d)|(\d)\s*x\s+(?=\d)/gi, (_match, left, right) => `${left ?? right} * `)
  .replace(/[×·]/g, "*")
  .replace(/÷/g, "/")
  .replace(/[−–]/g, "-")
  .replace(/→/g, "->");

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    mode: apiKey ? "langchain" : "demo",
    model: apiKey ? modelName : "local-demo",
    models: apiKey ? textModels : [],
    visionModels: apiKey ? visionModels : [],
    baseURL: baseURL || "default-openai",
    tools: mathTools.map((mathTool) => mathTool.name)
  });
});

app.post("/api/ask", rateLimit, async (request, response) => {
  const question = normalizeNotation(String(request.body?.question || "").trim().slice(0, 2000));
  const image = typeof request.body?.image === "string" ? request.body.image : "";

  if (image && !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(image)) {
    response.status(400).json({ error: "Images must be uploaded as png, jpg, webp, or gif." });
    return;
  }

  if (!question && !image) {
    response.status(400).json({ error: "Ask a math question or attach an image first." });
    return;
  }

  if (image && !apiKey) {
    response.status(400).json({
      error: "Image understanding needs an API key (vision model). Demo mode is text-only."
    });
    return;
  }

  try {
    let result;
    if (image) {
      const transcribed = await extractProblemFromImage(image, question);
      if (!transcribed) {
        response.status(422).json({ error: "Could not read a math problem from that image." });
        return;
      }
      result = await runLangChainAgent(transcribed);
      result.extractedFromImage = transcribed;
    } else if (apiKey) {
      try {
        result = await runLangChainAgent(question);
      } catch (error) {
        // Every AI model failed: keep the app useful with the local toolkit.
        if (!isModelUnavailable(error) && ![401, 402, 403].includes(error?.status)) throw error;
        console.warn("all models failed, answering in demo mode:", error?.message);
        result = { ...(await runDemoMathAgent(question)), fallback: true };
      }
    } else {
      result = await runDemoMathAgent(question);
    }
    response.json(result);
  } catch (error) {
    console.error("ask failed:", error);
    const status = error?.status ?? error?.response?.status;
    response.status(status === 429 ? 429 : 500).json({
      error: status === 429
        ? "The free AI model is busy right now. Give it a few seconds and try again."
        : "The math assistant hit a snag solving that. Try rephrasing, or break it into smaller parts."
    });
  }
});

export default app;

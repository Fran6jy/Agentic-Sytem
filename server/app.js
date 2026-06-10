import cors from "cors";
import "dotenv/config";
import express from "express";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { mathTools, toolMap } from "./mathTools.js";
import { runDemoMathAgent } from "./demoRouter.js";

const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL || process.env.OPENROUTER_BASE_URL;
const modelName = process.env.OPENAI_MODEL || "openai/gpt-oss-120b:free";
const visionModelName = process.env.OPENAI_VISION_MODEL || "nvidia/nemotron-nano-12b-v2-vl:free";
const openRouterHeaders = baseURL?.includes("openrouter.ai")
  ? {
      "HTTP-Referer": process.env.OPENROUTER_APP_URL || "https://github.com/Fran6jy/Agentic-Sytem",
      "X-Title": process.env.OPENROUTER_APP_NAME || "AI Math Assistant"
    }
  : undefined;

const app = express();

app.use(cors());
app.use(express.json({ limit: "12mb" }));

const systemPrompt = `You are an expert AI Math Assistant.
Use the provided tools for every calculation instead of mental arithmetic.
Give a concise answer, then a short explanation of what was computed.
When useful, mention the exact tool calls used.`;

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
    configuration: {
      baseURL,
      defaultHeaders: openRouterHeaders
    }
  });
  return options.tools ? chat.bindTools(options.tools) : chat;
};

const extractProblemFromImage = async (image, question) => {
  const model = makeModel(visionModelName, { temperature: 0 });
  const instruction = question
    ? `Transcribe the math problem in this image. Extra context from the user: ${question}`
    : "Transcribe the math problem in this image.";
  const response = await model.invoke([
    new SystemMessage(visionPrompt),
    new HumanMessage({
      content: [
        { type: "text", text: instruction },
        { type: "image_url", image_url: { url: image } }
      ]
    })
  ]);
  return String(response.content || "").trim();
};

const runLangChainAgent = async (question) => {
  const model = makeModel(modelName, { tools: mathTools });

  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(question)
  ];

  const trace = [];
  const firstResponse = await model.invoke(messages);
  messages.push(firstResponse);

  for (const toolCall of firstResponse.tool_calls || []) {
    const selectedTool = toolMap.get(toolCall.name);
    if (!selectedTool) continue;
    let result;
    let failed = false;
    try {
      result = await selectedTool.invoke(toolCall.args);
    } catch (toolError) {
      failed = true;
      result = `Error: ${toolError instanceof Error ? toolError.message : "tool failed"}. Try a different approach or solve it directly.`;
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

  const finalResponse = trace.length ? await model.invoke(messages) : firstResponse;

  return {
    answer: finalResponse.content,
    mode: "langchain",
    trace,
    toolsAvailable: mathTools.map((mathTool) => mathTool.name)
  };
};

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    mode: apiKey ? "langchain" : "demo",
    model: apiKey ? modelName : "local-demo",
    visionModel: apiKey ? visionModelName : null,
    baseURL: baseURL || "default-openai",
    tools: mathTools.map((mathTool) => mathTool.name)
  });
});

app.post("/api/ask", async (request, response) => {
  const question = String(request.body?.question || "").trim();
  const image = typeof request.body?.image === "string" ? request.body.image : "";

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
    } else {
      result = apiKey
        ? await runLangChainAgent(question)
        : await runDemoMathAgent(question);
    }
    response.json(result);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "The math assistant hit an unexpected error."
    });
  }
});

export default app;

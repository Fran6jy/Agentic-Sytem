import cors from "cors";
import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { mathTools, toolMap } from "./mathTools.js";
import { runDemoMathAgent } from "./demoRouter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "../dist");
const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json());

const systemPrompt = `You are an expert AI Math Assistant.
Use the provided tools for every calculation instead of mental arithmetic.
Give a concise answer, then a short explanation of what was computed.
When useful, mention the exact tool calls used.`;

const runLangChainAgent = async (question) => {
  const model = new ChatOpenAI({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    temperature: 0.1
  }).bindTools(mathTools);

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
    const result = await selectedTool.invoke(toolCall.args);
    trace.push({
      name: toolCall.name,
      args: toolCall.args,
      result
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
    mode: process.env.OPENAI_API_KEY ? "langchain" : "demo",
    tools: mathTools.map((mathTool) => mathTool.name)
  });
});

app.post("/api/ask", async (request, response) => {
  const question = String(request.body?.question || "").trim();
  if (!question) {
    response.status(400).json({ error: "Ask a math question first." });
    return;
  }

  try {
    const result = process.env.OPENAI_API_KEY
      ? await runLangChainAgent(question)
      : await runDemoMathAgent(question);
    response.json(result);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "The math assistant hit an unexpected error."
    });
  }
});

app.use(express.static(distPath));

app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`AI Math Assistant listening on http://127.0.0.1:${port}`);
});

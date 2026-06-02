# AI Math Assistant

A portfolio-ready math assistant that lets users ask natural-language math questions and routes the work through a LangChain.js tool-calling agent. It supports basic arithmetic, advanced expression evaluation, calculus helpers, equation solving, statistics, and matrix operations.

## Highlights

- LangChain tool calling with structured Zod schemas
- Express API with an OpenRouter/OpenAI-compatible path and a local demo fallback
- React interface with example prompts, trace visibility, and polished responsive styling
- Math toolkit powered by `mathjs`
- Image upload: a free vision model reads a photo of a problem, then the tool agent solves it
- Voice notes: dictate questions and have answers read aloud via the browser Web Speech API

## Run Locally

```bash
npm install
cp .env.example .env
npm run dev:full
```

Add `OPENAI_API_KEY` to `.env` for live LangChain tool calling. The default `.env.example` is configured for OpenRouter's free GPT-OSS model. Without a key, the app runs in demo mode and still executes the math toolkit locally.

Frontend: `http://127.0.0.1:5173`

API: `http://127.0.0.1:8787`

## Production

The app is ready for a single Node web service. Express serves both the API and the built React app.

```bash
npm install
npm run build
npm start
```

For Render, connect this GitHub repo and use the included `render.yaml`. Add `OPENAI_API_KEY` as a secret environment variable to enable live LangChain tool calling through OpenRouter. Without it, the hosted app stays usable in demo mode.

Recommended Render environment:

```txt
OPENAI_API_KEY=<your OpenRouter API key>
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=openai/gpt-oss-120b:free
OPENAI_VISION_MODEL=nvidia/nemotron-nano-12b-v2-vl:free
```

The server also supports other OpenAI-compatible providers by changing `OPENAI_BASE_URL` and `OPENAI_MODEL`. `OPENAI_VISION_MODEL` selects the multimodal model used to read uploaded images; the text model (`OPENAI_MODEL`) does the actual solving with the math tools. Voice input/output runs entirely in the browser and needs no extra configuration.

## Example Prompts

- `What is 18% of 245 plus 37 squared?`
- `Differentiate x^3 + 4x^2 - 7x + 9`
- `Solve 2x + 9 = 33 for x`
- `Find the determinant of [[4, 2], [1, 3]]`
- `Calculate the mean, median, and standard deviation of 12, 18, 21, 21, 30`

## Architecture

The backend exposes `POST /api/ask`, accepting a `question` and/or an `image` (base64 data URL). When an API key is present, it binds the LangChain tools to `ChatOpenAI`, points the client at the configured OpenAI-compatible base URL, lets the model choose the required tool calls, executes those tools, then asks the model to explain the result. When no key is present, it uses a small local intent router so the UI remains fully demonstrable.

When an image is attached, the vision model first transcribes the problem from the picture; that text then flows into the same tool-calling agent, so calculations stay exact and the tool trace is preserved (the transcription is returned as `extractedFromImage`). Image understanding requires an API key — demo mode is text-only. Voice input (dictation) and output (read-aloud) are implemented on the frontend with the browser's Web Speech API.

# Chalk Lab: AI Math Tutor

Ask a math question in plain English, by voice, or with a photo. Chalk Lab solves it with real math tools (not LLM mental arithmetic), walks you through each step like a tutor, and draws the graph on a chalkboard. A daily challenge with XP, levels, streaks and badges keeps you coming back.

## Highlights

- **Tool-calling agent**: LangChain.js with structured Zod schemas and 17 mathjs-backed tools covering arithmetic, algebra, calculus, statistics, matrices, complex numbers and units
- **Real equation solver**: exact roots (including complex) for polynomials up to cubic, plus numeric root search for anything else (trig, exponential, rational). Linear-only inputs are validated, so it no longer returns wrong answers for quadratics
- **Calculus**: symbolic derivatives, definite integrals (Simpson's rule) with exact polynomial antiderivatives, and limits that report one-sided behaviour
- **Live graphing**: an interactive chalk-style canvas you can pan, zoom and hover. It marks roots and crossings, shades integral areas, and frames the interesting region automatically
- **Step-by-step tutor mode**: hides the answer and reveals one hint or step at a time
- **Daily challenge and practice**: five seeded problems a day, the same set for everyone. Includes XP, hint penalties, levels from "Chalk Apprentice" to "Math Wizard", streaks, badges, and chalk-dust confetti
- **Photo and voice**: a vision model transcribes photos of problems, and the Web Speech API handles dictation and read-aloud
- **Resilient**: a fallback chain across free models, per-model timeouts, and automatic fallback to the local toolkit, so the app still answers when every AI model is busy
- **Hardened API**: per-IP rate limit, CORS restricted to your own origins, image type validation, and no upstream error leakage

## Run Locally

```bash
npm install
cp .env.example .env
npm run dev:full
```

Add `OPENAI_API_KEY` to `.env` for live tool calling. The defaults use OpenRouter free models. Keys that start with `sk-or-` select OpenRouter automatically. Without a key, the app runs in demo mode, which still runs the math toolkit locally, draws graphs and serves challenges.

Frontend: `http://127.0.0.1:5173`

API: `http://127.0.0.1:8787`

## Production

Express serves both the API and the built React app from one Node web service.

```bash
npm install
npm run build
npm start
```

For Vercel, `vercel.json` builds the Vite frontend and serves the Express API as a serverless function from `api/index.js`. For Render, use the included `render.yaml` and set `OPENAI_API_KEY` as a secret.

Environment:

```txt
OPENAI_API_KEY=<your OpenRouter API key>
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_MODEL=nvidia/nemotron-3-super-120b-a12b:free,qwen/qwen3.8-27b:free,google/gemma-4-31b-it:free
OPENAI_VISION_MODEL=qwen/qwen3.8-27b:free,google/gemma-4-31b-it:free
MODEL_TIMEOUT_MS=60000
ALLOWED_ORIGINS=            # optional, comma-separated; same-origin always works
RATE_LIMIT_PER_MINUTE=20
```

`OPENAI_MODEL` and `OPENAI_VISION_MODEL` are comma-separated fallback chains. OpenRouter rotates and rate-limits its free models often, so the server tries each model in order and remembers the last one that worked. For consistently fast answers, put a low-cost paid model first.

## Example Prompts

- `Solve x^2 - 5x + 6 = 0`
- `Differentiate x^3 + 4x^2 - 7x + 9`
- `Integrate x^2 from 0 to 3`
- `What is the limit of sin(x)/x as x approaches 0?`
- `Where do y = x^2 and y = 2x + 3 cross?`
- `Convert a 26.2 mile marathon to kilometres`
- `Find the determinant of [[4, 2], [1, 3]]`
- `Divide (3 + 2i) by (1 - 2i) and give the modulus`

## Architecture

`POST /api/ask` accepts a `question` and/or an `image` (a base64 data URL). With an API key, the server binds the tools to `ChatOpenAI`, runs up to six rounds of tool calls, and asks the model for a tutor-formatted reply (Answer, numbered Steps, Why it works). The response carries a `plot`, taken from `plot_function` calls or inferred from derivative, solve and integral calls, which the React canvas graph renders. Without a key, or when every model is unavailable, a local intent router produces the same response shape.

For photos, a vision model first transcribes the problem, and that text then goes through the same tool-calling agent, so calculations stay exact. Daily challenges are generated on the client from a date-seeded RNG, and progress is stored in `localStorage`.

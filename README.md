# AI Math Assistant

A portfolio-ready math assistant that lets users ask natural-language math questions and routes the work through a LangChain.js tool-calling agent. It supports basic arithmetic, advanced expression evaluation, calculus helpers, equation solving, statistics, and matrix operations.

## Highlights

- LangChain tool calling with structured Zod schemas
- Express API with an OpenAI-powered path and a local demo fallback
- React interface with example prompts, trace visibility, and polished responsive styling
- Math toolkit powered by `mathjs`

## Run Locally

```bash
npm install
cp .env.example .env
npm run dev:full
```

Add `OPENAI_API_KEY` to `.env` for live LangChain/OpenAI tool calling. Without a key, the app runs in demo mode and still executes the math toolkit locally.

Frontend: `http://127.0.0.1:5173`

API: `http://127.0.0.1:8787`

## Production

The app is ready for a single Node web service. Express serves both the API and the built React app.

```bash
npm install
npm run build
npm start
```

For Render, connect this GitHub repo and use the included `render.yaml`. Add `OPENAI_API_KEY` as a secret environment variable to enable live LangChain/OpenAI tool calling. Without it, the hosted app stays usable in demo mode.

## Example Prompts

- `What is 18% of 245 plus 37 squared?`
- `Differentiate x^3 + 4x^2 - 7x + 9`
- `Solve 2x + 9 = 33 for x`
- `Find the determinant of [[4, 2], [1, 3]]`
- `Calculate the mean, median, and standard deviation of 12, 18, 21, 21, 30`

## Architecture

The backend exposes `POST /api/ask`. When an OpenAI key is present, it binds the LangChain tools to `ChatOpenAI`, lets the model choose the required tool calls, executes those tools, then asks the model to explain the result. When no key is present, it uses a small local intent router so the UI remains fully demonstrable.

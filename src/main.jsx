import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BrainCircuit,
  Calculator,
  CheckCircle2,
  FlaskConical,
  FunctionSquare,
  ImagePlus,
  Loader2,
  Mic,
  Send,
  Sigma,
  Sparkles,
  Volume2,
  X
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "./styles.css";

// The model replies with LaTeX delimiters \[ \] and \( \); remark-math
// expects $$ $$ and $ $, so normalize before rendering.
const normalizeMath = (text) =>
  String(text || "")
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, body) => `\n\n$$${body}$$\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body) => `$${body}$`);

// Strip LaTeX/markdown markup so read-aloud speaks words, not "backslash frac".
const toSpeech = (text) =>
  String(text || "")
    .replace(/\\[[\]()]/g, " ")
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1 over $2")
    .replace(/\\sqrt\{([^{}]*)\}/g, "square root of $1")
    .replace(/\\boxed\{([^{}]*)\}/g, "$1")
    .replace(/\\(displaystyle|left|right|quad|qquad|Longrightarrow|Rightarrow|pm|cdot|times)/g, " ")
    .replace(/[\\${}*_#^]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const MathMarkdown = ({ text }) => (
  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
    {normalizeMath(text)}
  </ReactMarkdown>
);

const SpeechRecognition =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : undefined;
const speechSupported = Boolean(SpeechRecognition);
const synthSupported = typeof window !== "undefined" && "speechSynthesis" in window;

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });

// Downscale large photos so the payload stays under serverless body limits
// (Vercel caps requests around 4.5MB) while keeping text readable for OCR.
const MAX_IMAGE_DIMENSION = 1600;

const shrinkImage = (dataUrl) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
      if (scale === 1 && dataUrl.length < 2_000_000) {
        resolve(dataUrl);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

const examples = [
  "What is 18% of 245 plus 37 squared?",
  "Differentiate x^3 + 4x^2 - 7x + 9",
  "Solve 2x + 9 = 33 for x",
  "Find the determinant of [[4, 2], [1, 3]]",
  "Calculate the mean, median, and standard deviation of 12, 18, 21, 21, 30",
  "Divide (3 + 2i) by (1 - 2i) and give the modulus"
];

const capabilities = [
  { icon: Calculator, label: "Arithmetic", text: "Exact add, divide, powers, roots, and expression evaluation." },
  { icon: FunctionSquare, label: "Algebra", text: "Simplifies expressions and solves linear equations." },
  { icon: Sigma, label: "Statistics", text: "Mean, median, spread, ranges, and dataset summaries." },
  { icon: FlaskConical, label: "Calculus", text: "Symbolic derivatives with clear tool traces." }
];

function App() {
  const [question, setQuestion] = useState(examples[0]);
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [image, setImage] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const fileInputRef = useRef(null);

  const latest = history[0];
  const modeLabel = useMemo(() => {
    if (!latest) return "Ready";
    return latest.mode === "langchain" ? "LangChain live" : "Demo toolkit";
  }, [latest]);

  const ask = async (event) => {
    event.preventDefault();
    const trimmed = question.trim();
    if ((!trimmed && !image) || isLoading) return;
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, image: image?.dataUrl })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The assistant could not answer that.");
      const label = trimmed || (image ? `📷 ${image.name}` : "Image problem");
      setHistory((items) => [{ question: label, ...payload, createdAt: new Date().toLocaleTimeString() }, ...items]);
      setImage(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  };

  const onPickImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (png, jpg, or webp).");
      return;
    }
    try {
      const dataUrl = await shrinkImage(await fileToDataUrl(file));
      setImage({ name: file.name, dataUrl });
      setError("");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not read that file.");
    }
  };

  const toggleListening = () => {
    if (!speechSupported) {
      setError("Voice input is not supported in this browser. Try Chrome or Edge.");
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (resultEvent) => {
      const transcript = Array.from(resultEvent.results)
        .map((result) => result[0].transcript)
        .join(" ")
        .trim();
      setQuestion((current) => (current ? `${current} ${transcript}` : transcript));
    };
    recognition.onerror = (errorEvent) => {
      const messages = {
        network: "Voice input couldn't reach the speech service. This browser feature relies on Google's servers and works most reliably in desktop Google Chrome — it often fails in Firefox, Brave, or Chromium on Linux. You can still type or attach a photo.",
        "not-allowed": "Microphone access was blocked. Allow mic permission for this site and try again.",
        "service-not-allowed": "Microphone access was blocked. Allow mic permission for this site and try again.",
        "no-speech": "Didn't catch any speech — please try again."
      };
      setError(messages[errorEvent.error] || `Voice input error: ${errorEvent.error}`);
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const speakAnswer = (text) => {
    if (!synthSupported || !text) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  };

  useEffect(() => () => recognitionRef.current?.stop(), []);

  return (
    <main className="app-shell">
      <section className="hero-band">
        <div className="orbital-grid" aria-hidden="true">
          <span className="formula one">f'(x)</span>
          <span className="formula two">Σ</span>
          <span className="formula three">A⁻¹b</span>
        </div>
        <nav className="topbar" aria-label="Project status">
          <div className="brand">
            <span className="brand-mark"><BrainCircuit size={22} /></span>
            <span>AI Math Assistant</span>
          </div>
          <div className="status-pill">
            <Activity size={16} />
            {modeLabel}
          </div>
        </nav>

        <div className="hero-content">
          <div className="intro">
            <span className="eyebrow"><Sparkles size={16} /> LangChain Tool Calling</span>
            <h1>Ask math in plain English. Watch the tools do the work.</h1>
            <p>
              A polished math agent for arithmetic, algebra, calculus, statistics, and matrices,
              with transparent tool traces for every computed answer.
            </p>
          </div>

          <form className="ask-panel" onSubmit={ask}>
            <label htmlFor="question">Math prompt</label>
            <textarea
              id="question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask a math question, dictate it, or attach a photo..."
              rows={5}
            />
            {image ? (
              <div className="image-chip">
                <img src={image.dataUrl} alt={image.name} />
                <span>{image.name}</span>
                <button type="button" onClick={() => setImage(null)} aria-label="Remove image">
                  <X size={16} />
                </button>
              </div>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onPickImage}
              hidden
            />
            <div className="ask-actions">
              <div className="input-tools">
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach a photo of a problem"
                >
                  <ImagePlus size={18} />
                </button>
                <button
                  type="button"
                  className={`icon-button${isListening ? " listening" : ""}`}
                  onClick={toggleListening}
                  title={speechSupported ? "Dictate your question" : "Voice input not supported"}
                >
                  <Mic size={18} />
                </button>
              </div>
              <button type="submit" disabled={isLoading}>
                {isLoading ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
                {isLoading ? "Solving" : "Run assistant"}
              </button>
            </div>
            {isListening ? <p className="listening-hint">Listening… speak your math question.</p> : null}
            {error ? <p className="error">{error}</p> : null}
          </form>
        </div>
      </section>

      <section className="workspace">
        <aside className="examples-panel">
          <h2>Try a prompt</h2>
          <div className="prompt-list">
            {examples.map((example) => (
              <button key={example} type="button" onClick={() => setQuestion(example)}>
                {example}
              </button>
            ))}
          </div>
        </aside>

        <section className="answer-panel" aria-live="polite">
          {latest ? (
            <>
              <div className="answer-header">
                <div>
                  <span className="section-kicker">Latest answer</span>
                  <h2>{latest.question}</h2>
                </div>
                <div className="answer-meta">
                  {synthSupported ? (
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => speakAnswer(toSpeech(latest.answer))}
                      title="Read the answer aloud"
                    >
                      <Volume2 size={18} />
                    </button>
                  ) : null}
                  <span>{latest.createdAt}</span>
                </div>
              </div>
              {latest.extractedFromImage ? (
                <details className="extracted-note">
                  <summary>What the assistant read from your image</summary>
                  <MathMarkdown text={latest.extractedFromImage} />
                </details>
              ) : null}
              <div className="answer-body">
                <MathMarkdown text={latest.answer} />
              </div>
              <div className="trace-grid">
                {latest.trace.filter((step) => !step.failed).map((step, index) => (
                  <article className="trace-card" key={`${step.name}-${index}`}>
                    <div>
                      <CheckCircle2 size={18} />
                      <strong>{step.name}</strong>
                    </div>
                    <code>{JSON.stringify(step.args)}</code>
                    <p>{step.result}</p>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Calculator size={40} />
              <h2>Ready for a math question</h2>
              <p>Choose an example or write your own prompt to see the agent route work through tools.</p>
            </div>
          )}
        </section>
      </section>

      <section className="capability-strip">
        {capabilities.map(({ icon: Icon, label, text }) => (
          <article key={label}>
            <Icon size={22} />
            <h3>{label}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

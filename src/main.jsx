import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  Coffee,
  Flame,
  FlaskConical,
  GraduationCap,
  History,
  ImagePlus,
  Mic,
  NotebookPen,
  Send,
  Shuffle,
  Volume2,
  X
} from "lucide-react";
import AnswerBoard from "./components/AnswerBoard.jsx";
import Challenge from "./components/Challenge.jsx";
import MathMarkdown, { toSpeech } from "./components/MathMarkdown.jsx";
import MathText, { superscriptDigits } from "./components/MathText.jsx";
import { BADGES, levelFor, useProgress } from "./lib/progress.js";
import { chalkBurst } from "./lib/confetti.js";
import "./styles.css";

const Graph = lazy(() => import("./components/Graph.jsx"));

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
  { label: "Quadratic", text: "Solve x^2 - 5x + 6 = 0" },
  { label: "Derivative", text: "Differentiate x^3 + 4x^2 - 7x + 9" },
  { label: "Area", text: "Integrate x^2 from 0 to 3" },
  { label: "Limit", text: "What is the limit of sin(x)/x as x approaches 0?" },
  { label: "Percent", text: "What is 18% of 245 plus 37 squared?" },
  { label: "Stats", text: "Calculate the mean, median, and standard deviation of 12, 18, 21, 21, 30" },
  { label: "Matrix", text: "Find the determinant of [[4, 2], [1, 3]]" },
  { label: "Units", text: "Convert a 26.2 mile marathon to kilometres" }
];

const surprises = [
  "If I fold a 0.1 mm sheet of paper 42 times, how thick is it in kilometres?",
  "Where do y = x^2 and y = 2x + 3 cross?",
  "How many ways can 5 friends line up for a photo?",
  "A pizza has a 14 inch diameter. What's its area in square inches?",
  "Solve sin(x) = 0.5 for x between 0 and 7",
  "What is (1 + 1/x)^x as x goes to infinity?",
  "Find the area under x^3 - 2x from 0 to 2",
  "Divide (3 + 2i) by (1 - 2i) and give the modulus"
];

const keypad = [
  { label: "x²", insert: "²" },
  { label: "xⁿ", insert: "^" },
  { label: "√", insert: "√(" },
  { label: "π", insert: "π" },
  { label: "( )", insert: "()", cursorBack: 1 },
  { label: "=", insert: " = " },
  { label: "d/dx", insert: "Differentiate " },
  { label: "∫", insert: "Integrate " },
  { label: "lim", insert: "Limit as x → 0 of " }
];

const capabilities = [
  { icon: "∑", label: "Arithmetic & stats", text: "Exact evaluation, percentages, combinatorics, and dataset summaries." },
  { icon: "x²", label: "Algebra", text: "Linear, quadratic, polynomial, trig, and exponential equations." },
  { icon: "∫", label: "Calculus", text: "Derivatives, integrals with shaded area, and limits from both sides." },
  { icon: "▦", label: "Matrices & more", text: "Determinants, linear systems, complex numbers, and unit conversion." }
];

function ChalkUnderline() {
  return (
    <svg className="chalk-underline" viewBox="0 0 300 18" preserveAspectRatio="none" aria-hidden="true">
      <path d="M4 12 C 60 4, 120 16, 180 8 S 270 6, 296 10" />
    </svg>
  );
}

function Thinking() {
  return (
    <div className="thinking" role="status">
      <svg viewBox="0 0 220 60" aria-hidden="true">
        <path d="M10 40 q 15 -30 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0" />
      </svg>
      <p>Working it out on the board…</p>
    </div>
  );
}

function App() {
  const [view, setView] = useState("solve");
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [image, setImage] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [tutorMode, setTutorMode] = useState(false);
  const recognitionRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const resultRef = useRef(null);
  const { progress, addXp, recordDaily, completeDaily, dailyAnswers } = useProgress();
  const level = levelFor(progress.xp);
  const entry = history[selected];

  const ask = async (event, override) => {
    event?.preventDefault();
    const trimmed = (override ?? question).trim();
    if ((!trimmed && !image) || isLoading) return;
    if (override) setQuestion(override);
    setIsLoading(true);
    setError("");
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, image: image?.dataUrl })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The assistant could not answer that.");
      const label = trimmed || (image ? `📷 ${image.name}` : "Image problem");
      setHistory((items) => [{ question: label, ...payload, createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }, ...items].slice(0, 12));
      setSelected(0);
      setImage(null);
      addXp(2, { solved: 1, graphs: payload.plot ? 1 : 0 });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  };

  const insertAtCursor = ({ insert, cursorBack = 0 }) => {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? question.length;
    const end = element?.selectionEnd ?? question.length;
    const next = question.slice(0, start) + insert + question.slice(end);
    setQuestion(next);
    requestAnimationFrame(() => {
      element?.focus();
      const position = start + insert.length - cursorBack;
      element?.setSelectionRange(position, position);
    });
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
        network: "Voice input couldn't reach the speech service. This browser feature relies on Google's servers and works most reliably in desktop Google Chrome. You can still type or attach a photo.",
        "not-allowed": "Microphone access was blocked. Allow mic permission for this site and try again.",
        "service-not-allowed": "Microphone access was blocked. Allow mic permission for this site and try again.",
        "no-speech": "Didn't catch any speech. Please try again."
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

  // Celebrate level-ups.
  const lastLevel = useRef(level.number);
  useEffect(() => {
    if (level.number > lastLevel.current) chalkBurst({ count: 160 });
    lastLevel.current = level.number;
  }, [level.number]);

  const earnedBadges = BADGES.filter((badge) => badge.test(progress));

  return (
    <div className="page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Chalk Lab home">
          <span className="brand-mark" aria-hidden="true">∂</span>
          <span className="brand-name">Chalk Lab</span>
        </a>

        <nav className="tabs" aria-label="Sections">
          <button type="button" className={view === "solve" ? "on" : ""} onClick={() => setView("solve")}>
            <NotebookPen size={16} /> Solve
          </button>
          <button type="button" className={view === "challenge" ? "on" : ""} onClick={() => setView("challenge")}>
            <Flame size={16} /> Challenge
            {Object.keys(dailyAnswers).length < 5 ? <span className="dot" aria-label="Today's challenge is waiting" /> : null}
          </button>
        </nav>

        <div className="topbar-stats">
          <div className={`streak${progress.streak ? " lit" : ""}`} title="Daily challenge streak">
            <Flame size={17} />
            <strong>{progress.streak}</strong>
          </div>
          <div className="level" title={`${progress.xp} XP total`}>
            <span className="level-number">Lv {level.number}</span>
            <span className="level-title">{level.title}</span>
            <span className="xp-bar" aria-label={`${level.into} of ${level.next} XP to next level`}>
              <span style={{ width: `${level.into}%` }} />
            </span>
          </div>
          <a
            className="coffee"
            href="https://paypal.me/Fran6jy"
            target="_blank"
            rel="noopener noreferrer"
            title="Support this project with a coffee via PayPal"
          >
            <Coffee size={16} />
            <span>Buy me a coffee</span>
          </a>
        </div>
      </header>

      {view === "solve" ? (
        <main>
          <section className="hero">
            <div className="doodles" aria-hidden="true">
              <span className="doodle d1">e<sup>iπ</sup> + 1 = 0</span>
              <span className="doodle d2">∫ f(x) dx</span>
              <span className="doodle d3">a² + b² = c²</span>
              <span className="doodle d4">Σ 1/n²  = π²/6</span>
              <span className="doodle d5">f′(x)</span>
            </div>
            <h1>
              Ask any math question.
              <br />
              <span className="underlined">Watch it get solved<ChalkUnderline /></span> on the board.
            </h1>
            <p className="lede">
              Type it, say it, or snap a photo. Chalk Lab works it out with real math tools, walks you through
              every step, and draws the graph.
            </p>
          </section>

          <section className="board-wrap">
            <form className="board" onSubmit={ask}>
              <label htmlFor="question" className="sr-only">Your math question</label>
              <textarea
                id="question"
                ref={textareaRef}
                value={question}
                onChange={(event) => setQuestion(superscriptDigits(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) ask(event);
                }}
                placeholder="e.g. Solve x² − 5x + 6 = 0"
                rows={3}
              />

              {image ? (
                <div className="image-chip">
                  <img src={image.dataUrl} alt="" />
                  <span>{image.name}</span>
                  <button type="button" onClick={() => setImage(null)} aria-label="Remove image">
                    <X size={15} />
                  </button>
                </div>
              ) : null}

              <div className="keypad" aria-label="Math symbols">
                {keypad.map((key) => (
                  <button key={key.label} type="button" onClick={() => insertAtCursor(key)}>{key.label}</button>
                ))}
              </div>

              <input ref={fileInputRef} type="file" accept="image/*" onChange={onPickImage} hidden />

              <div className="board-actions">
                <div className="board-tools">
                  <button type="button" className="chalk-icon" onClick={() => fileInputRef.current?.click()} title="Snap or upload a photo of a problem" aria-label="Attach a photo">
                    <ImagePlus size={19} />
                  </button>
                  <button
                    type="button"
                    className={`chalk-icon${isListening ? " listening" : ""}`}
                    onClick={toggleListening}
                    title={speechSupported ? "Say your question" : "Voice input not supported in this browser"}
                    aria-label="Dictate question"
                    aria-pressed={isListening}
                  >
                    <Mic size={19} />
                  </button>
                  <button
                    type="button"
                    className="chalk-icon"
                    onClick={() => ask(null, surprises[Math.floor(Math.random() * surprises.length)])}
                    title="Surprise me with a fun problem"
                    aria-label="Surprise me"
                  >
                    <Shuffle size={19} />
                  </button>
                  <label className="tutor-toggle" title="Hide the answer and reveal steps one at a time">
                    <input type="checkbox" checked={tutorMode} onChange={(event) => setTutorMode(event.target.checked)} />
                    <span className="switch" aria-hidden="true" />
                    <GraduationCap size={16} /> Tutor mode
                  </label>
                </div>
                <button type="submit" className="chalk-button" disabled={isLoading || (!question.trim() && !image)}>
                  <Send size={18} />
                  {isLoading ? "Solving…" : "Solve it"}
                </button>
              </div>
              {isListening ? <p className="listening-hint">Listening… say your math question.</p> : null}
              {error ? <p className="error" role="alert">{error}</p> : null}

              <div className="chalk-tray" aria-hidden="true">
                <span className="chalk c1" /><span className="chalk c2" /><span className="chalk c3" /><span className="eraser" />
              </div>
            </form>

            <div className="examples" aria-label="Example questions">
              {examples.map((example) => (
                <button key={example.label} type="button" onClick={() => ask(null, example.text)} title={example.text}>
                  <span className="chip-label">{example.label}</span>
                  <MathText>{example.text}</MathText>
                </button>
              ))}
            </div>
          </section>

          <section className="results" ref={resultRef} aria-live="polite">
            {isLoading ? <Thinking /> : null}

            {!isLoading && entry ? (
              <div className="result-grid">
                <article className="result-card">
                  <header className="result-head">
                    <div>
                      <span className="kicker">You asked</span>
                      <h2><MathText>{entry.question}</MathText></h2>
                    </div>
                    <div className="result-meta">
                      {synthSupported ? (
                        <button type="button" className="chalk-icon" onClick={() => speakAnswer(toSpeech(entry.answer))} title="Read the answer aloud" aria-label="Read the answer aloud">
                          <Volume2 size={18} />
                        </button>
                      ) : null}
                      <span>{entry.createdAt}</span>
                    </div>
                  </header>

                  {entry.fallback ? (
                    <p className="fallback-note">
                      The free AI models are busy right now, so the built-in toolkit solved this one. Try again in a minute for a full tutor walkthrough.
                    </p>
                  ) : null}

                  {entry.extractedFromImage ? (
                    <details className="note">
                      <summary>What I read from your photo</summary>
                      <MathMarkdown text={entry.extractedFromImage} />
                    </details>
                  ) : null}

                  <AnswerBoard key={`${entry.createdAt}-${selected}-${tutorMode}`} text={entry.answer} tutorMode={tutorMode} />

                  {entry.plot ? (
                    <Suspense fallback={<div className="graph-loading">Sketching the graph…</div>}>
                      <Graph key={`${selected}-${JSON.stringify(entry.plot)}`} {...entry.plot} />
                    </Suspense>
                  ) : null}

                  {entry.trace?.some((step) => !step.failed) ? (
                    <details className="note lab-notes">
                      <summary><FlaskConical size={15} /> Lab notes: {entry.trace.filter((step) => !step.failed).length} tool call(s)</summary>
                      <ol>
                        {entry.trace.filter((step) => !step.failed).map((step, index) => (
                          <li key={`${step.name}-${index}`}>
                            <strong>{step.name.replace(/_/g, " ")}</strong>
                            <code>{JSON.stringify(step.args)}</code>
                            <span>→ {String(step.result)}</span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </article>

                {history.length > 1 ? (
                  <aside className="history">
                    <h3><History size={16} /> This session</h3>
                    <ul>
                      {history.map((item, index) => (
                        <li key={`${item.createdAt}-${index}`}>
                          <button type="button" className={index === selected ? "on" : ""} onClick={() => setSelected(index)}>
                            <MathText>{item.question}</MathText>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </aside>
                ) : null}
              </div>
            ) : null}

            {!isLoading && !entry ? (
              <div className="empty">
                <BookOpen size={30} />
                <p>Your worked solution will appear here. Pick an example above, or hit <Shuffle size={14} /> for a surprise.</p>
              </div>
            ) : null}
          </section>
        </main>
      ) : (
        <main>
          <Challenge
            progress={progress}
            addXp={addXp}
            recordDaily={recordDaily}
            completeDaily={completeDaily}
            dailyAnswers={dailyAnswers}
          />
          <section className="badges" aria-label="Badges">
            <h3>Badges</h3>
            <ul>
              {BADGES.map((badge) => {
                const earned = earnedBadges.includes(badge);
                return (
                  <li key={badge.id} className={earned ? "earned" : ""} title={badge.hint}>
                    <span className="badge-seal" aria-hidden="true">{earned ? "★" : "?"}</span>
                    <strong>{badge.label}</strong>
                    <small>{badge.hint}</small>
                  </li>
                );
              })}
            </ul>
          </section>
        </main>
      )}

      <footer className="footer">
        <div className="capabilities">
          {capabilities.map(({ icon, label, text }) => (
            <article key={label}>
              <span className="cap-icon" aria-hidden="true">{icon}</span>
              <h3>{label}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
        <p className="fine-print">
          Every number is computed by real math tools (mathjs), not guessed by the AI. Built by Francis.
        </p>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

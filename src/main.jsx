import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BrainCircuit,
  Calculator,
  CheckCircle2,
  FlaskConical,
  FunctionSquare,
  Loader2,
  Send,
  Sigma,
  Sparkles
} from "lucide-react";
import "./styles.css";

const examples = [
  "What is 18% of 245 plus 37 squared?",
  "Differentiate x^3 + 4x^2 - 7x + 9",
  "Solve 2x + 9 = 33 for x",
  "Find the determinant of [[4, 2], [1, 3]]",
  "Calculate the mean, median, and standard deviation of 12, 18, 21, 21, 30"
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

  const latest = history[0];
  const modeLabel = useMemo(() => {
    if (!latest) return "Ready";
    return latest.mode === "langchain" ? "LangChain live" : "Demo toolkit";
  }, [latest]);

  const ask = async (event) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isLoading) return;
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The assistant could not answer that.");
      setHistory((items) => [{ question: trimmed, ...payload, createdAt: new Date().toLocaleTimeString() }, ...items]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  };

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
              placeholder="Ask a math question..."
              rows={5}
            />
            <div className="ask-actions">
              <button type="submit" disabled={isLoading}>
                {isLoading ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
                {isLoading ? "Solving" : "Run assistant"}
              </button>
            </div>
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
                <span>{latest.createdAt}</span>
              </div>
              <div className="answer-body">{latest.answer}</div>
              <div className="trace-grid">
                {latest.trace.map((step, index) => (
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

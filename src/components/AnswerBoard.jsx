import { useState } from "react";
import { ChevronRight, Eye, Lightbulb, ListOrdered } from "lucide-react";
import MathMarkdown from "./MathMarkdown.jsx";

// Split the tutor-formatted reply into answer line, numbered steps, and the rest.
export const parseAnswer = (text) => {
  const source = String(text || "").replace(/\r/g, "");
  const answerMatch = source.match(/\*\*Answer:?\*\*:?\s*([^\n]+)/i);
  const stepsMatch = source.match(/#{2,4}\s*Steps\s*\n([\s\S]*?)(?=\n#{2,4}\s|\s*$)/i);
  const whyMatch = source.match(/#{2,4}\s*Why it works\s*\n([\s\S]*?)(?=\n#{2,4}\s|\s*$)/i);

  const steps = [];
  if (stepsMatch) {
    stepsMatch[1].split("\n").forEach((line) => {
      const item = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (item) steps.push(item[1]);
      else if (line.trim() && steps.length) steps[steps.length - 1] += ` ${line.trim()}`;
    });
  }

  if (!answerMatch && !steps.length) return { structured: false, raw: source };
  return {
    structured: true,
    answer: answerMatch?.[1]?.trim() ?? "",
    steps,
    why: whyMatch?.[1]?.trim() ?? "",
    // Anything the model wrote outside the known sections, so nothing gets lost.
    extra: source
      .replace(answerMatch?.[0] ?? "", "")
      .replace(stepsMatch ? stepsMatch[0] : "", "")
      .replace(whyMatch ? whyMatch[0] : "", "")
      .trim()
  };
};

// Parents key this by answer + tutor mode, so reveal state resets on remount.
export default function AnswerBoard({ text, tutorMode }) {
  const parsed = parseAnswer(text);
  const [revealed, setRevealed] = useState(tutorMode ? 0 : Infinity);
  const [answerShown, setAnswerShown] = useState(!tutorMode);

  if (!parsed.structured) {
    return <div className="answer-body"><MathMarkdown text={parsed.raw} /></div>;
  }

  const { answer, steps, why, extra } = parsed;
  const allStepsShown = revealed >= steps.length;

  return (
    <div className="answer-board">
      <div className={`final-answer${answerShown ? " shown" : ""}`}>
        <span className="final-label">Answer</span>
        {answerShown ? (
          <div className="final-value"><MathMarkdown text={answer} inline /></div>
        ) : (
          <button type="button" className="reveal-answer" onClick={() => setAnswerShown(true)}>
            <Eye size={16} /> Try it yourself first, then tap to reveal
          </button>
        )}
      </div>

      {steps.length ? (
        <section className="steps">
          <header>
            <h3><ListOrdered size={18} /> Step by step</h3>
            {!allStepsShown ? (
              <button type="button" className="text-button" onClick={() => setRevealed(Infinity)}>Show all</button>
            ) : null}
          </header>
          <ol>
            {steps.map((step, index) => (
              <li
                key={`${index}-${step.slice(0, 12)}`}
                className={index < revealed ? "visible" : "hidden"}
                style={{ "--delay": `${tutorMode ? 0 : index * 110}ms` }}
                aria-hidden={index >= revealed}
              >
                <span className="step-number">{index + 1}</span>
                <div><MathMarkdown text={step} inline /></div>
              </li>
            ))}
          </ol>
          {!allStepsShown ? (
            <button type="button" className="next-step" onClick={() => setRevealed((count) => count + 1)}>
              <Lightbulb size={16} />
              {revealed === 0 ? "Give me a hint" : `Next step (${revealed}/${steps.length})`}
              <ChevronRight size={16} />
            </button>
          ) : null}
        </section>
      ) : null}

      {why && allStepsShown ? (
        <aside className="why">
          <strong>Why it works</strong>
          <MathMarkdown text={why} />
        </aside>
      ) : null}

      {extra && allStepsShown ? <div className="answer-body"><MathMarkdown text={extra} /></div> : null}
    </div>
  );
}

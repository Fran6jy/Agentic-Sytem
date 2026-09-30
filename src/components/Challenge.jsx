import { Suspense, lazy, useMemo, useRef, useState } from "react";
import { Check, Dices, Flame, Lightbulb, RotateCw, Trophy, X } from "lucide-react";
import MathMarkdown from "./MathMarkdown.jsx";
import { XP_NO_HINT_BONUS, XP_PER_CORRECT, dailySet, isCorrect, parseGuess, practiceProblem } from "../lib/challenges.js";
import { todayKey } from "../lib/progress.js";
import { chalkBurst } from "../lib/confetti.js";

const Graph = lazy(() => import("./Graph.jsx"));

const cheers = ["Nailed it!", "Chalk-tastic!", "Brilliant!", "Textbook!", "You're on fire!", "Big brain move!"];

function ProblemCard({ problem, onResult, previous, compact }) {
  const [guess, setGuess] = useState(previous?.guess ?? "");
  const [usedHint, setUsedHint] = useState(false);
  const [result, setResult] = useState(previous ?? null);
  const [shake, setShake] = useState(false);
  const inputRef = useRef(null);

  const submit = (event) => {
    event.preventDefault();
    if (result || !guess.trim()) return;
    if (Number.isNaN(parseGuess(guess))) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
      return;
    }
    const correct = isCorrect(guess, problem.answer);
    const outcome = { guess, correct, usedHint };
    setResult(outcome);
    if (correct) {
      const rect = inputRef.current?.getBoundingClientRect();
      chalkBurst(rect ? { x: rect.left + rect.width / 2, y: rect.top } : undefined);
    }
    onResult(outcome);
  };

  const giveUp = () => {
    const outcome = { guess: guess || "(none)", correct: false, usedHint: true, gaveUp: true };
    setResult(outcome);
    onResult(outcome);
  };

  return (
    <article className={`problem-card${result ? (result.correct ? " correct" : " wrong") : ""}`}>
      <header>
        <span className="topic-tag">{problem.topic}</span>
        {problem.difficulty ? (
          <span className="difficulty" aria-label={`Difficulty ${problem.difficulty} of 5`}>
            {"★".repeat(problem.difficulty)}<span>{"★".repeat(5 - problem.difficulty)}</span>
          </span>
        ) : null}
      </header>
      <p className="problem-question">{problem.question}</p>
      <div className="problem-math"><MathMarkdown text={`$$${problem.prompt}$$`} /></div>

      <form className={`guess-row${shake ? " shake" : ""}`} onSubmit={submit}>
        <input
          ref={inputRef}
          value={guess}
          onChange={(event) => setGuess(event.target.value)}
          placeholder="Your answer"
          inputMode="decimal"
          disabled={Boolean(result)}
          aria-label="Your answer"
        />
        {!result ? (
          <button type="submit" className="chalk-button small">Check</button>
        ) : (
          <span className={`verdict ${result.correct ? "yes" : "no"}`}>
            {result.correct ? <Check size={18} /> : <X size={18} />}
            {result.correct ? cheers[problem.id.length % cheers.length] : `It's ${problem.answer}`}
          </span>
        )}
      </form>

      {!result ? (
        <div className="problem-help">
          {!usedHint ? (
            <button type="button" className="text-button" onClick={() => setUsedHint(true)}>
              <Lightbulb size={14} /> Hint (−{XP_NO_HINT_BONUS} XP bonus)
            </button>
          ) : (
            <p className="hint"><Lightbulb size={14} /> {problem.hint}</p>
          )}
          <button type="button" className="text-button muted" onClick={giveUp}>Show answer</button>
        </div>
      ) : (
        <div className="problem-explain">
          {result.correct ? (
            <p className="xp-earned">+{XP_PER_CORRECT + (result.usedHint ? 0 : XP_NO_HINT_BONUS)} XP</p>
          ) : null}
          <MathMarkdown text={problem.explain} />
          {problem.plot && !compact ? (
            <Suspense fallback={<div className="graph-loading">Sketching…</div>}>
              <Graph key={problem.id} {...problem.plot} />
            </Suspense>
          ) : null}
        </div>
      )}
    </article>
  );
}

export default function Challenge({ progress, addXp, recordDaily, completeDaily, dailyAnswers }) {
  const [mode, setMode] = useState("daily");
  const [practiceSeed, setPracticeSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [practiceRun, setPracticeRun] = useState({ right: 0, total: 0 });
  const day = todayKey();
  const problems = useMemo(() => dailySet(day), [day]);
  const practice = useMemo(() => practiceProblem(practiceSeed), [practiceSeed]);

  const answeredCount = Object.keys(dailyAnswers).length;
  const rightCount = Object.values(dailyAnswers).filter((answer) => answer.correct).length;
  const dailyDone = answeredCount >= problems.length;
  const firstOpen = problems.findIndex((_problem, index) => !dailyAnswers[index]);
  const [active, setActive] = useState(firstOpen === -1 ? 0 : firstOpen);

  const reward = (outcome) => {
    if (outcome.correct) addXp(XP_PER_CORRECT + (outcome.usedHint ? 0 : XP_NO_HINT_BONUS), { correct: 1 });
  };

  const onDailyResult = (index) => (outcome) => {
    recordDaily(index, outcome);
    reward(outcome);
    if (answeredCount + 1 >= problems.length) {
      completeDaily();
      if (rightCount + (outcome.correct ? 1 : 0) === problems.length) {
        setTimeout(() => chalkBurst({ count: 180 }), 350);
      }
    } else {
      setTimeout(() => setActive(index + 1), outcome.correct ? 1100 : 2200);
    }
  };

  return (
    <section className="challenge">
      <div className="challenge-head">
        <div>
          <span className="kicker">Daily chalk challenge</span>
          <h2>{mode === "daily" ? "Five problems. One streak. Go." : "Endless practice"}</h2>
        </div>
        <div className="segmented" role="tablist" aria-label="Challenge mode">
          <button type="button" role="tab" aria-selected={mode === "daily"} className={mode === "daily" ? "on" : ""} onClick={() => setMode("daily")}>
            <Flame size={15} /> Daily
          </button>
          <button type="button" role="tab" aria-selected={mode === "practice"} className={mode === "practice" ? "on" : ""} onClick={() => setMode("practice")}>
            <Dices size={15} /> Practice
          </button>
        </div>
      </div>

      {mode === "daily" ? (
        <>
          <ol className="daily-dots" aria-label="Daily progress">
            {problems.map((problem, index) => {
              const answer = dailyAnswers[index];
              const state = answer ? (answer.correct ? "right" : "missed") : index === active ? "current" : "open";
              return (
                <li key={problem.id}>
                  <button type="button" className={state} onClick={() => setActive(index)} aria-label={`Problem ${index + 1}: ${state}`}>
                    {answer ? (answer.correct ? <Check size={14} /> : <X size={14} />) : index + 1}
                  </button>
                </li>
              );
            })}
          </ol>

          {dailyDone ? (
            <div className="daily-summary">
              <Trophy size={34} />
              <div>
                <h3>{rightCount === problems.length ? "Perfect board!" : `${rightCount} of ${problems.length} today`}</h3>
                <p>
                  Streak: <strong>{progress.streak} day{progress.streak === 1 ? "" : "s"}</strong>. A fresh set appears tomorrow.
                  Keep sharpening in Practice.
                </p>
              </div>
              <button type="button" className="chalk-button small" onClick={() => setMode("practice")}>Practice</button>
            </div>
          ) : null}

          <ProblemCard
            key={problems[active].id}
            problem={problems[active]}
            previous={dailyAnswers[active]}
            onResult={onDailyResult(active)}
          />
        </>
      ) : (
        <>
          <p className="practice-score">
            This run: <strong>{practiceRun.right}</strong> / {practiceRun.total} correct
          </p>
          <ProblemCard
            key={practice.id}
            problem={practice}
            onResult={(outcome) => {
              reward(outcome);
              setPracticeRun((run) => ({ right: run.right + (outcome.correct ? 1 : 0), total: run.total + 1 }));
            }}
          />
          <button type="button" className="chalk-button ghost" onClick={() => setPracticeSeed((seed) => seed + 7919)}>
            <RotateCw size={16} /> New problem
          </button>
        </>
      )}
    </section>
  );
}

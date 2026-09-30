import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "chalk-lab-progress-v1";

export const todayKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const yesterdayKey = () => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return todayKey(date);
};

const emptyProgress = {
  xp: 0,
  solved: 0,
  correct: 0,
  graphs: 0,
  streak: 0,
  bestStreak: 0,
  lastDailyDay: null,
  daily: {}
};

const load = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return stored ? { ...emptyProgress, ...stored } : emptyProgress;
  } catch {
    return emptyProgress;
  }
};

export const LEVELS = [
  "Chalk Apprentice",
  "Number Ninja",
  "Equation Wrangler",
  "Graph Whisperer",
  "Calculus Cadet",
  "Theorem Tamer",
  "Proof Pirate",
  "Math Wizard"
];

export const levelFor = (xp) => {
  const level = Math.floor(xp / 100);
  return {
    number: level + 1,
    title: LEVELS[Math.min(level, LEVELS.length - 1)],
    into: xp % 100,
    next: 100
  };
};

export const BADGES = [
  { id: "first-solve", label: "First Chalk", hint: "Solve your first problem", test: (p) => p.solved >= 1 },
  { id: "graph-5", label: "Graph Gazer", hint: "See 5 graphs", test: (p) => p.graphs >= 5 },
  { id: "correct-10", label: "Sharp Mind", hint: "Answer 10 challenges right", test: (p) => p.correct >= 10 },
  { id: "streak-3", label: "On Fire", hint: "3-day challenge streak", test: (p) => p.bestStreak >= 3 },
  { id: "streak-7", label: "Unstoppable", hint: "7-day challenge streak", test: (p) => p.bestStreak >= 7 },
  { id: "xp-500", label: "Wizard in Training", hint: "Earn 500 XP", test: (p) => p.xp >= 500 }
];

export function useProgress() {
  const [progress, setProgress] = useState(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // Private mode or blocked storage: progress just lasts for this visit.
    }
  }, [progress]);

  // A streak only survives if yesterday (or today) had a completed daily challenge.
  const liveStreak = [todayKey(), yesterdayKey()].includes(progress.lastDailyDay) ? progress.streak : 0;

  const addXp = useCallback((amount, extra = {}) => {
    setProgress((current) => ({
      ...current,
      xp: current.xp + amount,
      solved: current.solved + (extra.solved ?? 0),
      correct: current.correct + (extra.correct ?? 0),
      graphs: current.graphs + (extra.graphs ?? 0)
    }));
  }, []);

  const recordDaily = useCallback((index, result) => {
    setProgress((current) => {
      const day = todayKey();
      const answers = { ...(current.daily[day] || {}), [index]: result };
      return { ...current, daily: { [day]: answers } };
    });
  }, []);

  const completeDaily = useCallback(() => {
    setProgress((current) => {
      const day = todayKey();
      if (current.lastDailyDay === day) return current;
      const streak = current.lastDailyDay === yesterdayKey() ? current.streak + 1 : 1;
      return { ...current, streak, bestStreak: Math.max(current.bestStreak, streak), lastDailyDay: day };
    });
  }, []);

  return {
    progress: { ...progress, streak: liveStreak },
    addXp,
    recordDaily,
    completeDaily,
    dailyAnswers: progress.daily[todayKey()] || {}
  };
}

// Deterministic problem generator: the same day always gives everyone the same daily set.

const mulberry32 = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const hashString = (text) => [...text].reduce((hash, char) => Math.imul(31, hash) + char.charCodeAt(0) | 0, 7);

const makeRandom = (seed) => {
  const next = mulberry32(seed);
  const int = (min, max) => Math.floor(next() * (max - min + 1)) + min;
  const nonZero = (min, max) => {
    let value = 0;
    while (value === 0) value = int(min, max);
    return value;
  };
  const pick = (items) => items[Math.floor(next() * items.length)];
  return { int, nonZero, pick };
};

const signed = (value, first = false) => {
  if (first) return `${value}`;
  return value < 0 ? `- ${Math.abs(value)}` : `+ ${value}`;
};

const term = (coefficient, variable, first = false) => {
  const magnitude = Math.abs(coefficient) === 1 ? "" : Math.abs(coefficient);
  if (first) return `${coefficient < 0 ? "-" : ""}${magnitude}${variable}`;
  return `${coefficient < 0 ? "-" : "+"} ${magnitude}${variable}`;
};

const GENERATORS = {
  arithmetic: (r) => {
    const a = r.int(12, 60);
    const b = r.int(3, 12);
    const c = r.int(3, 12);
    const d = r.int(5, 40);
    return {
      topic: "Order of operations",
      prompt: `${a} + ${b} \\times ${c} - ${d}`,
      question: "Evaluate:",
      answer: a + b * c - d,
      hint: "Multiplication comes before addition and subtraction.",
      explain: `\\(${b} \\times ${c} = ${b * c}\\), then \\(${a} + ${b * c} - ${d} = ${a + b * c - d}\\).`
    };
  },
  percent: (r) => {
    const p = r.pick([5, 10, 15, 20, 25, 30, 40, 75]);
    const n = r.int(2, 30) * 20;
    return {
      topic: "Percentages",
      prompt: `${p}\\% \\text{ of } ${n}`,
      question: "What is",
      answer: (p * n) / 100,
      hint: `${p}% means ${p} out of every 100. Try finding 10% first.`,
      explain: `\\(\\frac{${p}}{100} \\times ${n} = ${(p * n) / 100}\\).`
    };
  },
  linear: (r) => {
    const x = r.int(-9, 12);
    const a = r.nonZero(-7, 9);
    const b = r.int(-20, 20);
    const c = a * x + b;
    return {
      topic: "Linear equations",
      prompt: `${term(a, "x", true)} ${signed(b)} = ${c}`,
      question: "Solve for x:",
      answer: x,
      hint: "Undo the addition first, then the multiplication.",
      explain: `Subtract ${b}: \\(${a}x = ${c - b}\\). Divide by ${a}: \\(x = ${x}\\).`,
      plot: { expressions: [`${a}x + ${b}`, `${c}`] }
    };
  },
  system: (r) => {
    const x = r.int(-6, 12);
    const y = r.int(-6, 12);
    return {
      topic: "Systems of equations",
      prompt: `\\begin{cases} x + y = ${x + y} \\\\ x - y = ${x - y} \\end{cases}`,
      question: "Find x:",
      answer: x,
      hint: "Add the two equations together; y cancels out.",
      explain: `Adding gives \\(2x = ${2 * x}\\), so \\(x = ${x}\\).`,
      plot: { expressions: [`${x + y} - x`, `x - ${x - y}`] }
    };
  },
  derivative: (r) => {
    const a = r.nonZero(-4, 5);
    const b = r.int(-9, 9);
    const c = r.int(-9, 9);
    const k = r.int(-4, 5);
    return {
      topic: "Derivatives",
      prompt: `f(x) = ${term(a, "x^2", true)} ${term(b || 1, "x")} ${signed(c)}`.replace(/\+ 1x/, "+ x"),
      question: `Find f'(${k}) for`,
      answer: 2 * a * k + (b || 1),
      hint: "Power rule: the derivative of ax² is 2ax, of bx is b, of a constant is 0.",
      explain: `\\(f'(x) = ${2 * a}x ${signed(b || 1)}\\), so \\(f'(${k}) = ${2 * a * k + (b || 1)}\\).`,
      plot: { expressions: [`${a}x^2 + ${b || 1}x + ${c}`, `${2 * a}x + ${b || 1}`] }
    };
  },
  roots: (r) => {
    const r1 = r.int(-8, 9);
    let r2 = r.int(-8, 9);
    if (r2 === r1) r2 += 3;
    const sum = r1 + r2;
    const product = r1 * r2;
    return {
      topic: "Quadratics",
      prompt: `x^2 ${term(-sum || 0, "x")} ${signed(product)} = 0`.replace(/\+ 0x |- 0x /, ""),
      question: "Find the larger root of",
      answer: Math.max(r1, r2),
      hint: `Look for two numbers that multiply to ${product} and add to ${sum}.`,
      explain: `It factors as \\((x ${signed(-r1)})(x ${signed(-r2)}) = 0\\), so \\(x = ${r1}\\) or \\(x = ${r2}\\).`,
      plot: { expressions: [`x^2 - ${sum}x + ${product}`] }
    };
  },
  area: (r) => {
    const a = r.int(1, 5);
    const k = r.int(1, 6);
    return {
      topic: "Integrals",
      prompt: `\\int_0^{${k}} ${2 * a}x \\, dx`,
      question: "Evaluate:",
      answer: a * k * k,
      hint: "The antiderivative of cx is cx²/2. Or: it's the area of a triangle!",
      explain: `\\(\\left[${a}x^2\\right]_0^{${k}} = ${a * k * k}\\).`,
      plot: { expressions: [`${2 * a}x`], xMin: -1, xMax: k + 2, shade: { from: 0, to: k } }
    };
  },
  limit: (r) => {
    const k = r.nonZero(-6, 7);
    return {
      topic: "Limits",
      prompt: `\\lim_{x \\to ${k}} \\frac{x^2 - ${k * k}}{x ${signed(-k)}}`,
      question: "Evaluate:",
      answer: 2 * k,
      hint: "Factor the top as a difference of squares.",
      explain: `\\(\\frac{(x-${k})(x+${k})}{x-${k}} = x + ${k}\\), which approaches \\(${2 * k}\\).`,
      plot: { expressions: [`(x^2 - ${k * k}) / (x - ${k})`] }
    };
  }
};

const DAILY_ORDER = [
  ["arithmetic", "percent"],
  ["linear", "percent"],
  ["system", "roots"],
  ["derivative", "limit"],
  ["area", "derivative"]
];

export const XP_PER_CORRECT = 10;
export const XP_NO_HINT_BONUS = 5;

export const dailySet = (dayKey) => {
  const random = makeRandom(hashString(dayKey));
  return DAILY_ORDER.map((options, index) => ({
    id: `${dayKey}-${index}`,
    difficulty: index + 1,
    ...GENERATORS[random.pick(options)](random)
  }));
};

export const practiceProblem = (seed) => {
  const random = makeRandom(seed);
  const type = random.pick(Object.keys(GENERATORS));
  return { id: `practice-${seed}`, ...GENERATORS[type](random) };
};

// Accept "4", "x = 4", "-3.5", "7/2", "  12 ".
export const parseGuess = (input) => {
  const cleaned = String(input).toLowerCase().replace(/[a-z]\s*=/g, "").replace(/\s+/g, "").replace(/−/g, "-");
  if (!cleaned) return Number.NaN;
  const fractionMatch = cleaned.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
  if (fractionMatch) return Number(fractionMatch[1]) / Number(fractionMatch[2]);
  return /^-?\d*\.?\d+$/.test(cleaned) ? Number(cleaned) : Number.NaN;
};

export const isCorrect = (guess, answer) => Math.abs(parseGuess(guess) - answer) < 1e-6;

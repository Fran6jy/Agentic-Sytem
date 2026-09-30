import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

// The model replies with LaTeX delimiters \[ \] and \( \); remark-math
// expects $$ $$ and $ $, so normalize before rendering.
export const normalizeMath = (text) =>
  String(text || "")
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, body) => `\n\n$$${body}$$\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body) => `$${body}$`);

// Strip LaTeX/markdown markup so read-aloud speaks words, not "backslash frac".
export const toSpeech = (text) =>
  String(text || "")
    .replace(/\\[[\]()]/g, " ")
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1 over $2")
    .replace(/\\sqrt\{([^{}]*)\}/g, "square root of $1")
    .replace(/\\boxed\{([^{}]*)\}/g, "$1")
    .replace(/\\(displaystyle|left|right|quad|qquad|Longrightarrow|Rightarrow|pm|cdot|times)/g, " ")
    .replace(/#+\s*/g, " ")
    .replace(/[\\${}*_^]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export default function MathMarkdown({ text, inline = false }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={inline ? { p: ({ children }) => <span>{children}</span> } : undefined}
    >
      {normalizeMath(text)}
    </ReactMarkdown>
  );
}

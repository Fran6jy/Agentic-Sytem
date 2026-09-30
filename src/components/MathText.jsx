// Shows plain-text math the way it's written on paper: x^2 → x², 3 * x → 3·x, sqrt( → √(.
const SUPERSCRIPT = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "-": "⁻" };

// Used while typing: turns "^12" into "¹²" once the exponent is finished.
export const superscriptDigits = (text) =>
  text.replace(/\s*\^\s*(-?\d+)(?=[^\d.]|$)/g, (_match, digits) => [...digits].map((char) => SUPERSCRIPT[char]).join(""));

export default function MathText({ children }) {
  const text = String(children ?? "")
    .replace(/\s*\*\s*/g, "·")
    .replace(/sqrt\(/g, "√(")
    .replace(/\bpi\b/g, "π");
  // Split out every ^exponent (a number, a word, or a parenthesised group) and raise it.
  const parts = text.split(/\s*\^\s*(\([^()]*\)|-?[\w.]+)/);
  return (
    <>
      {parts.map((part, index) => (index % 2
        ? <sup key={index}>{part.replace(/^\((.*)\)$/, "$1")}</sup>
        : <span key={index}>{part}</span>))}
    </>
  );
}

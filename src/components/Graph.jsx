import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compile } from "mathjs";
import { Crosshair, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import MathText from "./MathText.jsx";

export const CURVE_COLORS = ["#f4d35e", "#8ecae6", "#f7a1c4", "#a7e8a1"];
const SAMPLES = 900;

const niceStep = (span) => {
  const raw = span / 8;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power;
};

const formatTick = (value, step) => {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(value.toFixed(decimals)).toString();
};

const toReal = (value) => {
  if (typeof value === "number") return value;
  if (value && typeof value.re === "number" && Math.abs(value.im) < 1e-9) return value.re;
  return Number.NaN;
};

// Pick a y-range that shows the interesting part without letting asymptotes flatten everything.
const autoYRange = (curves, xMin, xMax) => {
  const values = [];
  curves.forEach(({ fn }) => {
    for (let i = 0; i <= 200; i += 1) {
      const y = fn(xMin + ((xMax - xMin) * i) / 200);
      if (Number.isFinite(y)) values.push(y);
    }
  });
  if (!values.length) return [-10, 10];
  values.sort((a, b) => a - b);
  let low = values[Math.floor(values.length * 0.04)];
  let high = values[Math.ceil(values.length * 0.96) - 1];
  low = Math.min(low, 0);
  high = Math.max(high, 0);
  if (high - low < 1e-6) { low -= 1; high += 1; }
  const pad = (high - low) * 0.15;
  return [low - pad, high + pad];
};

// Points where two curves cross (or one curve crosses zero), found by sign changes + bisection.
const findCrossings = (curves, xMin, xMax) => {
  const pairs = curves.length === 1
    ? [[curves[0].fn, () => 0]]
    : curves.slice(1).map((curve) => [curves[0].fn, curve.fn]);
  const points = [];
  pairs.forEach(([f, g]) => {
    const h = (x) => f(x) - g(x);
    const n = 600;
    let prevX = xMin;
    let prevH = h(prevX);
    for (let i = 1; i <= n; i += 1) {
      const x = xMin + ((xMax - xMin) * i) / n;
      const current = h(x);
      if (Number.isFinite(prevH) && Number.isFinite(current) && prevH * current <= 0 && !(prevH === 0 && current === 0)) {
        let lo = prevX;
        let hi = x;
        for (let k = 0; k < 50; k += 1) {
          const mid = (lo + hi) / 2;
          if (h(lo) * h(mid) <= 0) hi = mid; else lo = mid;
        }
        const root = (lo + hi) / 2;
        const y = f(root);
        if (Math.abs(h(root)) < 1e-4 && Number.isFinite(y) && !points.some((p) => Math.abs(p.x - root) < (xMax - xMin) / 400)) {
          points.push({ x: root, y });
        }
      }
      prevX = x;
      prevH = current;
    }
  });
  return points.slice(0, 12);
};

export default function Graph({ expressions, xMin = -10, xMax = 10, shade }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const [size, setSize] = useState({ width: 600, height: 340 });
  const [hover, setHover] = useState(null);
  const [progress, setProgress] = useState(() => (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 1 : 0
  ));

  const curves = useMemo(() => expressions.map((expression, index) => {
    try {
      const code = compile(expression);
      return {
        expression,
        color: CURVE_COLORS[index % CURVE_COLORS.length],
        fn: (x) => {
          try { return toReal(code.evaluate({ x })); } catch { return Number.NaN; }
        }
      };
    } catch {
      return null;
    }
  }).filter(Boolean), [expressions]);

  const initialView = useMemo(() => {
    let left = xMin;
    let right = xMax;
    // For the default window, zoom in around where the action is (roots / crossings).
    if (xMin === -10 && xMax === 10 && !shade) {
      const points = findCrossings(curves, xMin, xMax);
      if (points.length) {
        const lo = Math.min(...points.map((point) => point.x));
        const hi = Math.max(...points.map((point) => point.x));
        const pad = Math.max(2.5, (hi - lo) * 0.6);
        left = Math.floor(lo - pad);
        right = Math.ceil(hi + pad);
      }
    }
    const [yMin, yMax] = autoYRange(curves, left, right);
    return { xMin: left, xMax: right, yMin, yMax };
  }, [curves, xMin, xMax, shade]);

  // Parents remount the graph (via key) for new data, so the initial view only needs computing once.
  const [view, setView] = useState(initialView);

  const crossings = useMemo(() => findCrossings(curves, view.xMin, view.xMax), [curves, view.xMin, view.xMax]);

  // Chalk-drawing animation whenever a new set of curves arrives.
  useEffect(() => {
    if (progress >= 1) return undefined;
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / 900);
      setProgress(1 - (1 - t) ** 3);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(260, Math.floor(entry.contentRect.width));
      setSize({ width, height: Math.round(Math.min(420, Math.max(240, width * 0.58))) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const toScreen = useCallback((x, y) => [
    ((x - view.xMin) / (view.xMax - view.xMin)) * size.width,
    size.height - ((y - view.yMin) / (view.yMax - view.yMin)) * size.height
  ], [view, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const xStep = niceStep(view.xMax - view.xMin);
    const yStep = niceStep(view.yMax - view.yMin);
    ctx.font = "13px Kalam, cursive";
    ctx.lineWidth = 1;

    // Grid
    ctx.strokeStyle = "rgba(238, 240, 230, 0.07)";
    for (let x = Math.ceil(view.xMin / xStep) * xStep; x <= view.xMax; x += xStep) {
      const [sx] = toScreen(x, 0);
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, size.height); ctx.stroke();
    }
    for (let y = Math.ceil(view.yMin / yStep) * yStep; y <= view.yMax; y += yStep) {
      const [, sy] = toScreen(0, y);
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(size.width, sy); ctx.stroke();
    }

    // Axes, clamped to the edges when the origin is off-screen
    const [originX, originY] = toScreen(0, 0);
    const axisX = Math.min(size.width - 1, Math.max(1, originX));
    const axisY = Math.min(size.height - 1, Math.max(1, originY));
    ctx.strokeStyle = "rgba(238, 240, 230, 0.55)";
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(0, axisY); ctx.lineTo(size.width, axisY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(axisX, 0); ctx.lineTo(axisX, size.height); ctx.stroke();

    ctx.fillStyle = "rgba(238, 240, 230, 0.6)";
    ctx.textAlign = "center";
    for (let x = Math.ceil(view.xMin / xStep) * xStep; x <= view.xMax; x += xStep) {
      if (Math.abs(x) < xStep / 2) continue;
      const [sx] = toScreen(x, 0);
      ctx.fillText(formatTick(x, xStep), sx, Math.min(size.height - 6, axisY + 16));
    }
    ctx.textAlign = "right";
    for (let y = Math.ceil(view.yMin / yStep) * yStep; y <= view.yMax; y += yStep) {
      if (Math.abs(y) < yStep / 2) continue;
      const [, sy] = toScreen(0, y);
      ctx.fillText(formatTick(y, yStep), Math.max(30, axisX - 6), sy + 4);
    }

    // Shaded area for definite integrals, drawn as chalk hatching
    if (shade && curves[0]) {
      ctx.save();
      ctx.beginPath();
      const [startX, zeroY] = toScreen(shade.from, 0);
      ctx.moveTo(startX, zeroY);
      for (let i = 0; i <= 200; i += 1) {
        const x = shade.from + ((shade.to - shade.from) * i) / 200;
        const y = curves[0].fn(x);
        if (Number.isFinite(y)) ctx.lineTo(...toScreen(x, y));
      }
      ctx.lineTo(toScreen(shade.to, 0)[0], zeroY);
      ctx.closePath();
      ctx.fillStyle = "rgba(244, 211, 94, 0.12)";
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = "rgba(244, 211, 94, 0.35)";
      ctx.lineWidth = 1;
      for (let offset = -size.height; offset < size.width; offset += 9) {
        ctx.beginPath(); ctx.moveTo(offset, size.height); ctx.lineTo(offset + size.height, 0); ctx.stroke();
      }
      ctx.restore();
    }

    // Curves: drawn twice with a little jitter so they look like chalk strokes
    const visibleUntil = view.xMin + (view.xMax - view.xMin) * progress;
    curves.forEach(({ fn, color }) => {
      [[3.2, 0.9, 0], [1.2, 0.35, 0.8]].forEach(([width, alpha, jitter]) => {
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        let penDown = false;
        let lastY = null;
        for (let i = 0; i <= SAMPLES; i += 1) {
          const x = view.xMin + ((view.xMax - view.xMin) * i) / SAMPLES;
          if (x > visibleUntil) break;
          const y = fn(x);
          const [sx, sy] = toScreen(x, y);
          // Break the path at discontinuities (like tan or 1/x) instead of drawing a vertical line.
          const jump = lastY !== null && Math.abs(sy - lastY) > size.height * 1.5;
          if (!Number.isFinite(y) || jump) { penDown = false; lastY = Number.isFinite(y) ? sy : null; continue; }
          const jy = jitter ? sy + Math.sin(i * 1.7) * jitter : sy;
          if (!penDown) { ctx.moveTo(sx, jy); penDown = true; } else ctx.lineTo(sx, jy);
          lastY = sy;
        }
        ctx.stroke();
      });
    });
    ctx.globalAlpha = 1;

    // Crossings / roots
    if (progress >= 1) {
      crossings.forEach(({ x, y }) => {
        const [sx, sy] = toScreen(x, y);
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#1c2723";
        ctx.fill();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = "#eef0e6";
        ctx.stroke();
      });
    }

    // Hover crosshair
    if (hover) {
      const [sx] = toScreen(hover.x, 0);
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = "rgba(238, 240, 230, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, size.height); ctx.stroke();
      ctx.setLineDash([]);
      curves.forEach(({ fn, color }) => {
        const y = fn(hover.x);
        if (!Number.isFinite(y)) return;
        const [, sy] = toScreen(hover.x, y);
        ctx.beginPath();
        ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });
    }
  }, [curves, view, size, toScreen, progress, hover, crossings, shade]);

  const toWorldX = (clientX) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return view.xMin + ((clientX - rect.left) / rect.width) * (view.xMax - view.xMin);
  };

  const zoom = (factor, centerX = (view.xMin + view.xMax) / 2, centerY = (view.yMin + view.yMax) / 2) => {
    setView((current) => ({
      xMin: centerX - (centerX - current.xMin) * factor,
      xMax: centerX + (current.xMax - centerX) * factor,
      yMin: centerY - (centerY - current.yMin) * factor,
      yMax: centerY + (current.yMax - centerY) * factor
    }));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = view.xMin + ((event.clientX - rect.left) / rect.width) * (view.xMax - view.xMin);
      const cy = view.yMax - ((event.clientY - rect.top) / rect.height) * (view.yMax - view.yMin);
      zoom(event.deltaY > 0 ? 1.15 : 1 / 1.15, cx, cy);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  });

  const onPointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, view };
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (drag) {
      const rect = canvasRef.current.getBoundingClientRect();
      const dx = ((event.clientX - drag.x) / rect.width) * (drag.view.xMax - drag.view.xMin);
      const dy = ((event.clientY - drag.y) / rect.height) * (drag.view.yMax - drag.view.yMin);
      setView({
        xMin: drag.view.xMin - dx,
        xMax: drag.view.xMax - dx,
        yMin: drag.view.yMin + dy,
        yMax: drag.view.yMax + dy
      });
      return;
    }
    setHover({ x: toWorldX(event.clientX) });
  };

  const endDrag = () => { dragRef.current = null; };

  const hoverValues = hover
    ? curves.map(({ fn, color, expression }) => ({ color, expression, y: fn(hover.x) }))
    : [];

  if (!curves.length) return null;

  return (
    <figure className="graph">
      <div className="graph-toolbar">
        <ul className="graph-legend">
          {curves.map(({ expression, color }) => (
            <li key={expression}>
              <span style={{ background: color }} />
              <span className="legend-expr">y = <MathText>{expression}</MathText></span>
            </li>
          ))}
        </ul>
        <div className="graph-controls">
          <button type="button" className="chalk-icon" onClick={() => zoom(1 / 1.4)} title="Zoom in" aria-label="Zoom in"><ZoomIn size={16} /></button>
          <button type="button" className="chalk-icon" onClick={() => zoom(1.4)} title="Zoom out" aria-label="Zoom out"><ZoomOut size={16} /></button>
          <button type="button" className="chalk-icon" onClick={() => setView(initialView)} title="Reset view" aria-label="Reset view"><RotateCcw size={16} /></button>
        </div>
      </div>
      <div className="graph-canvas" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          style={{ width: size.width, height: size.height }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => { endDrag(); setHover(null); }}
          role="img"
          aria-label={`Graph of ${curves.map((curve) => `y = ${curve.expression}`).join(" and ")}`}
        />
        {hover ? (
          <div className="graph-readout">
            <span>x = {hover.x.toFixed(3)}</span>
            {hoverValues.map(({ color, expression, y }) => (
              <span key={expression} style={{ color }}>
                y = {Number.isFinite(y) ? y.toFixed(3) : "undefined"}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <figcaption>
        <Crosshair size={14} />
        {crossings.length
          ? `${curves.length > 1 ? "Crossings" : "Roots"}: ${crossings.slice(0, 5).map(({ x }) => `x ≈ ${Number(x.toFixed(4))}`).join(", ")}`
          : "Drag to pan, scroll to zoom, hover to read values."}
      </figcaption>
    </figure>
  );
}

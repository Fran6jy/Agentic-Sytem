import { useCallback, useEffect, useRef, useState } from "react";

export const CHALKS = [
  { id: "white", label: "White chalk", color: "#eef0e6" },
  { id: "pink", label: "Pink chalk", color: "#f7a1c4" },
  { id: "blue", label: "Blue chalk", color: "#8ecae6" }
];

const MASK_SCALE = 0.25; // the wipe mask is low-res; the soft upscale looks like smudged chalk
const CLEAR_AT = 0.72; // share of the written area that must be rubbed out to clear the board
const TAP_DISTANCE = 6;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Where the writing actually is, so wiping blank board doesn't count toward clearing it.
const textBounds = (textarea, text) => {
  const style = getComputedStyle(textarea);
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const padLeft = parseFloat(style.paddingLeft);
  const padTop = parseFloat(style.paddingTop);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  const usable = textarea.clientWidth - padLeft * 2;
  let lines = 0;
  let widest = 0;
  text.split("\n").forEach((line) => {
    const width = ctx.measureText(line || " ").width;
    lines += Math.max(1, Math.ceil(width / usable));
    widest = Math.max(widest, Math.min(width, usable));
  });
  return {
    x: padLeft,
    y: padTop - textarea.scrollTop,
    width: Math.max(24, widest),
    height: Math.min(textarea.clientHeight, lines * lineHeight)
  };
};

export default function ChalkTray({ boardRef, textareaRef, text, onWiped, chalk, onPickChalk }) {
  const eraserRef = useRef(null);
  const dustRef = useRef(null);
  const particleCanvasRef = useRef(null);
  const maskRef = useRef(null);
  const dragRef = useRef(null);
  const lastPointRef = useRef(null);
  const particlesRef = useRef([]);
  const frameRef = useRef(0);
  const [offset, setOffset] = useState(null);
  const [wiping, setWiping] = useState(false);

  const applyMask = useCallback(() => {
    const textarea = textareaRef.current;
    const mask = maskRef.current;
    if (!textarea || !mask) return;
    const url = `url(${mask.toDataURL()})`;
    textarea.style.maskImage = url;
    textarea.style.webkitMaskImage = url;
  }, [textareaRef]);

  const resetMask = useCallback(() => {
    const textarea = textareaRef.current;
    maskRef.current = null;
    if (!textarea) return;
    textarea.style.maskImage = "";
    textarea.style.webkitMaskImage = "";
  }, [textareaRef]);

  // Typing new chalk marks restores a clean board.
  useEffect(() => {
    if (!dragRef.current && !wiping) resetMask();
  }, [text, wiping, resetMask]);

  const ensureMask = () => {
    const textarea = textareaRef.current;
    if (maskRef.current || !textarea) return maskRef.current;
    const mask = document.createElement("canvas");
    mask.width = Math.max(1, Math.round(textarea.clientWidth * MASK_SCALE));
    mask.height = Math.max(1, Math.round(textarea.clientHeight * MASK_SCALE));
    const ctx = mask.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, mask.width, mask.height);
    maskRef.current = mask;
    return mask;
  };

  // Dust and smear live on one canvas over the board; a single loop animates both.
  const runDust = useCallback(() => {
    const canvas = dustRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const pctx = particleCanvasRef.current?.getContext("2d");
    const step = () => {
      const particles = particlesRef.current;
      // Smear fades slowly, like chalk settling.
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.035)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
      // Dust gets a fresh layer each frame so falling specks don't leave trails.
      if (pctx) pctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i];
        p.vy += 0.12;
        p.vx *= 0.97;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        if (pctx) {
          pctx.fillStyle = `rgba(238, 240, 230, ${Math.min(0.6, p.life / 60)})`;
          pctx.fillRect(p.x, p.y, p.size, p.size);
        }
      }
      frameRef.current = particles.length || dragRef.current ? requestAnimationFrame(step) : requestAnimationFrame(fadeOut);
    };
    // Keep fading the smear for a while after the dust has settled.
    let fadeFrames = 90;
    const fadeOut = () => {
      if (particlesRef.current.length) { frameRef.current = requestAnimationFrame(step); return; }
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.04)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
      fadeFrames -= 1;
      frameRef.current = fadeFrames > 0 ? requestAnimationFrame(fadeOut) : 0;
    };
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  const sizeDustCanvas = () => {
    const board = boardRef.current;
    if (!board) return;
    const dpr = window.devicePixelRatio || 1;
    const width = board.clientWidth;
    const height = board.clientHeight;
    [dustRef.current, particleCanvasRef.current].forEach((canvas) => {
      if (!canvas || canvas.width === Math.round(width * dpr)) return;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  };

  // Rub at a point given in viewport coordinates (the eraser's centre).
  const rubAt = useCallback((clientX, clientY) => {
    const textarea = textareaRef.current;
    const board = boardRef.current;
    const eraser = eraserRef.current;
    if (!textarea || !board || !eraser) return 0;
    const mask = ensureMask();
    const tRect = textarea.getBoundingClientRect();
    const bRect = board.getBoundingClientRect();
    const brushW = eraser.offsetWidth * 0.95;
    const brushH = eraser.offsetHeight * 1.6;

    const from = lastPointRef.current ?? { x: clientX, y: clientY };
    const distance = Math.hypot(clientX - from.x, clientY - from.y);
    const steps = Math.max(1, Math.ceil(distance / 6));
    const mctx = mask.getContext("2d");
    const dust = dustRef.current?.getContext("2d");
    mctx.globalCompositeOperation = "destination-out";

    for (let s = 1; s <= steps; s += 1) {
      const x = from.x + ((clientX - from.x) * s) / steps;
      const y = from.y + ((clientY - from.y) * s) / steps;
      // Felt isn't perfectly even: a solid core plus a few streaky passes.
      const mx = (x - tRect.left) * MASK_SCALE;
      const my = (y - tRect.top) * MASK_SCALE;
      const w = brushW * MASK_SCALE;
      const h = brushH * MASK_SCALE;
      mctx.fillStyle = "rgba(0,0,0,0.55)";
      mctx.fillRect(mx - w / 2, my - h / 2, w, h);
      for (let k = 0; k < 3; k += 1) {
        mctx.fillStyle = `rgba(0,0,0,${0.2 + Math.random() * 0.3})`;
        mctx.fillRect(mx - w / 2, my - h / 2 + Math.random() * h, w, Math.max(1, h * 0.15));
      }

      if (dust) {
        // Faint smear left behind on the slate.
        dust.fillStyle = "rgba(238, 240, 230, 0.012)";
        dust.fillRect(x - bRect.left - brushW / 2, y - bRect.top - brushH / 2, brushW, brushH);
      }
    }
    lastPointRef.current = { x: clientX, y: clientY };

    // Only rubbing over the writing throws chalk dust.
    const bounds = textBounds(textarea, text);
    const overText = clientX > tRect.left + bounds.x - brushW / 2
      && clientX < tRect.left + bounds.x + bounds.width + brushW / 2
      && clientY > tRect.top + bounds.y - brushH / 2
      && clientY < tRect.top + bounds.y + bounds.height + brushH / 2;
    if (overText && distance > 1 && !reducedMotion()) {
      for (let i = 0; i < Math.min(8, distance / 3); i += 1) {
        particlesRef.current.push({
          x: clientX - bRect.left + (Math.random() - 0.5) * brushW,
          y: clientY - bRect.top + brushH / 2 * Math.random(),
          vx: (Math.random() - 0.5) * 1.2,
          vy: Math.random() * 0.6,
          size: 1 + Math.random() * 2,
          life: 30 + Math.random() * 40
        });
      }
    }

    // How much of the writing is gone?
    const region = {
      x: Math.max(0, Math.floor(bounds.x * MASK_SCALE)),
      y: Math.max(0, Math.floor(bounds.y * MASK_SCALE)),
      w: Math.max(1, Math.ceil(bounds.width * MASK_SCALE)),
      h: Math.max(1, Math.ceil(bounds.height * MASK_SCALE))
    };
    region.w = Math.min(region.w, mask.width - region.x);
    region.h = Math.min(region.h, mask.height - region.y);
    if (region.w <= 0 || region.h <= 0) return 1;
    const pixels = mask.getContext("2d").getImageData(region.x, region.y, region.w, region.h).data;
    let cleared = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 110) cleared += 1;
    return cleared / (pixels.length / 4);
  }, [boardRef, textareaRef, text]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishWipe = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) textarea.classList.add("wiped");
    setTimeout(() => {
      onWiped();
      resetMask();
      textarea?.classList.remove("wiped");
    }, 180);
  }, [onWiped, resetMask, textareaRef]);

  const scheduleMask = () => {
    if (scheduleMask.pending) return;
    scheduleMask.pending = true;
    requestAnimationFrame(() => { scheduleMask.pending = false; applyMask(); });
  };

  const eraserCentre = () => {
    const rect = eraserRef.current.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };

  // Tap: the duster sweeps back and forth over the writing by itself.
  const autoWipe = () => {
    const textarea = textareaRef.current;
    const eraser = eraserRef.current;
    if (!textarea || !eraser || wiping) return;
    if (!text.trim()) {
      eraser.classList.remove("nudge");
      void eraser.offsetWidth;
      eraser.classList.add("nudge");
      return;
    }
    if (reducedMotion()) { finishWipe(); return; }
    setWiping(true);
    sizeDustCanvas();
    const home = eraserCentre();
    const tRect = textarea.getBoundingClientRect();
    const bounds = textBounds(textarea, text);
    const left = tRect.left + bounds.x + eraser.offsetWidth * 0.3;
    const right = tRect.left + bounds.x + Math.max(bounds.width, eraser.offsetWidth) - eraser.offsetWidth * 0.3;
    const top = tRect.top + bounds.y + eraser.offsetHeight * 0.6;
    const bottom = tRect.top + bounds.y + Math.max(bounds.height - eraser.offsetHeight * 0.6, eraser.offsetHeight * 0.6);
    const passes = Math.max(3, Math.ceil((bottom - top) / (eraser.offsetHeight * 1.2)) + 2);
    const waypoints = [];
    for (let i = 0; i <= passes; i += 1) {
      const y = top + ((bottom - top) * i) / passes;
      waypoints.push(i % 2 ? { x: left, y } : { x: right, y });
    }
    waypoints.unshift({ x: left, y: top });
    const duration = 380 + passes * 170;
    const start = performance.now();
    lastPointRef.current = waypoints[0];
    dragRef.current = { auto: true };
    runDust();

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const position = eased * (waypoints.length - 1);
      const index = Math.min(waypoints.length - 2, Math.floor(position));
      const local = position - index;
      const a = waypoints[index];
      const b = waypoints[index + 1];
      const x = a.x + (b.x - a.x) * local;
      const y = a.y + (b.y - a.y) * local;
      setOffset({ x: x - home.x, y: y - home.y, tilt: (b.x > a.x ? 1 : -1) * 6 });
      rubAt(x, y);
      scheduleMask();
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        dragRef.current = null;
        lastPointRef.current = null;
        setOffset(null);
        setWiping(false);
        finishWipe();
      }
    };
    requestAnimationFrame(tick);
  };

  const onPointerDown = (event) => {
    if (wiping) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sizeDustCanvas();
    const centre = eraserCentre();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      grabX: event.clientX - centre.x,
      grabY: event.clientY - centre.y,
      homeX: centre.x,
      homeY: centre.y,
      moved: 0,
      lastX: event.clientX
    };
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.auto) return;
    drag.moved = Math.max(drag.moved, Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY));
    if (drag.moved < TAP_DISTANCE) return;
    const x = event.clientX - drag.grabX;
    const y = event.clientY - drag.grabY;
    const tilt = Math.max(-10, Math.min(10, (event.clientX - drag.lastX) * 0.8));
    drag.lastX = event.clientX;
    setOffset({ x: x - drag.homeX, y: y - drag.homeY, tilt, held: true });
    if (!drag.dusting) { drag.dusting = true; runDust(); }
    if (!text.trim()) return;
    const cleared = rubAt(x, y);
    scheduleMask();
    if (cleared >= CLEAR_AT) drag.done = true;
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (!drag || drag.auto) return;
    dragRef.current = null;
    lastPointRef.current = null;
    setOffset(null);
    if (drag.moved < TAP_DISTANCE) { autoWipe(); return; }
    if (drag.done) finishWipe();
  };

  const eraserStyle = offset
    ? { transform: `translate(${offset.x}px, ${offset.y}px) rotate(${offset.tilt ?? 0}deg)`, transition: offset.held || wiping ? "none" : undefined }
    : undefined;

  return (
    <>
      <canvas ref={dustRef} className="board-dust" aria-hidden="true" />
      <canvas ref={particleCanvasRef} className="board-dust" aria-hidden="true" />
      <div className="chalk-tray">
        {CHALKS.map((stick) => (
          <button
            key={stick.id}
            type="button"
            className={`chalk c-${stick.id}${chalk === stick.id ? " held" : ""}`}
            style={{ "--stick": stick.color }}
            onClick={() => onPickChalk(stick.id)}
            aria-label={stick.label}
            aria-pressed={chalk === stick.id}
            title={`Write in ${stick.id}`}
          />
        ))}
        <button
          ref={eraserRef}
          type="button"
          className={`eraser${offset ? " lifted" : ""}`}
          style={eraserStyle}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); autoWipe(); }
          }}
          onAnimationEnd={(event) => event.currentTarget.classList.remove("nudge")}
          aria-label="Duster: drag across the board to erase, or tap to wipe it clean"
          title="Drag to erase, tap to wipe"
        >
          <span className="eraser-felt" aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

// Chalk-dust burst: little rectangles of chalk in the board's palette.
const COLORS = ["#f4d35e", "#8ecae6", "#f7a1c4", "#a7e8a1", "#eef0e6"];

export function chalkBurst({ x = window.innerWidth / 2, y = window.innerHeight / 2, count = 90 } = {}) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.className = "confetti-layer";
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const pieces = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 9;
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 5,
      w: 4 + Math.random() * 7,
      h: 2 + Math.random() * 3,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)]
    };
  });

  const start = performance.now();
  const frame = (now) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - elapsed / 1600);
    pieces.forEach((piece) => {
      piece.vy += 0.32;
      piece.vx *= 0.985;
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.rotation += piece.spin;
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rotation);
      ctx.fillStyle = piece.color;
      ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
      ctx.restore();
    });
    if (elapsed < 1600) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

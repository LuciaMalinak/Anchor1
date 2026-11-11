"use client";

import { useEffect, useRef } from "react";

// The homepage hero's background: hundreds of points of light drift like
// scattered notes from calls, gather into a large anchor behind the title,
// hold, and drift apart again, on a slow loop. The cursor gently scatters
// them. Canvas, no libraries; pauses when off screen, and shows the anchor
// formed and still for anyone who prefers reduced motion.

const MAX_PARTICLES = 2800;
const CYCLE_S = 14; // drift 2.5s · gather 3.5s · hold 5s · release 3s

type P = { tx: number; ty: number; x: number; y: number; vx: number; vy: number; seed: number; copper: boolean };

function drawAnchor(o: CanvasRenderingContext2D) {
  o.lineCap = "round";
  o.strokeStyle = "#fff";
  o.lineWidth = 30;
  o.beginPath();
  o.arc(256, 92, 38, 0, Math.PI * 2);
  o.stroke();
  o.beginPath();
  o.moveTo(256, 160);
  o.lineTo(256, 430);
  o.moveTo(164, 196);
  o.lineTo(348, 196);
  o.stroke();
  o.beginPath();
  o.moveTo(104, 300);
  o.bezierCurveTo(112, 392, 180, 446, 256, 446);
  o.bezierCurveTo(332, 446, 400, 392, 408, 300);
  o.stroke();
  o.fillStyle = "#fff";
  for (const [a, b, c] of [
    [70, 104, 140],
    [372, 408, 442],
  ]) {
    o.beginPath();
    o.moveTo(a, 318);
    o.lineTo(b, 252);
    o.lineTo(c, 318);
    o.fill();
  }
}

export function AnchorAssemble() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0;
    let H = 0;
    let D = 1;
    let parts: P[] = [];
    let start = performance.now();
    let raf = 0;
    let onScreen = true;
    const pointer = { x: 0, y: 0, active: false };

    function build() {
      const rect = canvas!.getBoundingClientRect();
      D = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas!.width = Math.max(1, Math.round(rect.width * D));
      H = canvas!.height = Math.max(1, Math.round(rect.height * D));
      // Sample the anchor's shape: every few pixels inside it is a target.
      const off = document.createElement("canvas");
      off.width = W;
      off.height = H;
      const o = off.getContext("2d")!;
      const s = Math.min(W * 0.96, H * 1.0);
      o.translate(W / 2 - s / 2, H / 2 - s / 2);
      o.scale(s / 512, s / 512);
      drawAnchor(o);
      const img = o.getImageData(0, 0, W, H).data;
      const step = Math.max(3, Math.round(4 * D));
      let pts: [number, number][] = [];
      for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) if (img[(y * W + x) * 4 + 3] > 128) pts.push([x, y]);
      if (pts.length > MAX_PARTICLES) {
        const keep = MAX_PARTICLES / pts.length;
        pts = pts.filter(() => Math.random() < keep);
      }
      parts = pts.map(([tx, ty], i) => ({
        tx,
        ty,
        x: Math.random() * W,
        y: Math.random() * H,
        vx: 0,
        vy: 0,
        seed: i * 1.7,
        copper: Math.random() < 0.18,
      }));
    }

    function frame(now: number) {
      const t = (now - start) / 1000;
      const cycle = t % CYCLE_S;
      const pull = cycle < 2.5 ? 0 : cycle < 6 ? (cycle - 2.5) / 3.5 : cycle < 11 ? 1 : 1 - (cycle - 11) / 3;
      const R = 90 * D;
      ctx!.clearRect(0, 0, W, H);
      ctx!.globalCompositeOperation = "lighter";
      for (const q of parts) {
        q.vx += (q.tx - q.x) * 0.012 * pull + Math.sin(t * 0.4 + q.seed) * 0.07 * D * (1 - pull);
        q.vy += (q.ty - q.y) * 0.012 * pull + Math.cos(t * 0.33 + q.seed) * 0.07 * D * (1 - pull);
        if (pointer.active) {
          const dx = q.x - pointer.x;
          const dy = q.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < R) {
            const f = (1 - d / R) * 2.2;
            q.vx += (dx / (d + 1)) * f;
            q.vy += (dy / (d + 1)) * f;
          }
        }
        q.vx *= 0.88;
        q.vy *= 0.88;
        q.x += q.vx;
        q.y += q.vy;
        if (pull === 0) {
          if (q.x < 0) q.x += W;
          if (q.x > W) q.x -= W;
          if (q.y < 0) q.y += H;
          if (q.y > H) q.y -= H;
        }
        ctx!.fillStyle = q.copper ? "rgba(224,162,122,0.9)" : `rgba(255,255,255,${0.16 + 0.5 * pull})`;
        ctx!.fillRect(q.x, q.y, 2.2 * D, 2.2 * D);
      }
      ctx!.globalCompositeOperation = "source-over";
    }

    function loop(now: number) {
      if (onScreen) frame(now);
      raf = requestAnimationFrame(loop);
    }

    function stillFrame() {
      // Settle every point on the anchor and draw it once.
      for (const q of parts) {
        q.x = q.tx;
        q.y = q.ty;
      }
      start = performance.now() - 8000;
      frame(performance.now());
    }

    build();
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = (e.clientX - r.left) * D;
      pointer.y = (e.clientY - r.top) * D;
      pointer.active = true;
    };
    const onLeave = () => (pointer.active = false);
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        build();
        if (reduce) stillFrame();
      }, 150);
    };
    const io = new IntersectionObserver(([e]) => (onScreen = e.isIntersecting), { threshold: 0.02 });
    io.observe(canvas);
    window.addEventListener("resize", onResize);
    if (reduce) {
      stillFrame();
    } else {
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}

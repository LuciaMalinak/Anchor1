"use client";

import { useEffect, useRef } from "react";

// The homepage hero's background: hundreds of points of light roam the
// whole hero as a network of neurons (fine lines link nearby points), then
// stream together into a large anchor behind the title, hold, and burst
// back out to the edges, on a slow loop. The cursor gently scatters
// them. Canvas, no libraries; pauses when off screen, and shows the anchor
// formed and still for anyone who prefers reduced motion.

const MAX_PARTICLES = 2800;
const CYCLE_S = 14; // roam as a network 3s · gather 2s · hold 5s · burst out and roam 4s

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
      // 1.5x is plenty for soft points of light and keeps older laptops and phones smooth.
      D = Math.min(window.devicePixelRatio || 1, 1.5);
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

    // Fine lines between nearby points while they roam: a network of
    // neurons across the whole hero. Every fourth point takes part, found
    // through a coarse grid so it stays cheap.
    function drawLinks(alpha: number) {
      if (alpha <= 0.01) return;
      const L = 86 * D;
      const grid = new Map<number, P[]>();
      const cols = Math.ceil(W / L) + 1;
      for (let i = 0; i < parts.length; i += 4) {
        const q = parts[i];
        const k = Math.floor(q.y / L) * cols + Math.floor(q.x / L);
        const cell = grid.get(k);
        if (cell) cell.push(q);
        else grid.set(k, [q]);
      }
      const near = new Path2D();
      const far = new Path2D();
      for (const [k, cell] of grid) {
        for (const nk of [k, k + 1, k + cols - 1, k + cols, k + cols + 1]) {
          const other = grid.get(nk);
          if (!other) continue;
          for (const a of cell)
            for (const b of other) {
              if (nk === k && a >= b) continue;
              const d = Math.hypot(a.x - b.x, a.y - b.y);
              if (d > L) continue;
              const path = d < L * 0.55 ? near : far;
              path.moveTo(a.x, a.y);
              path.lineTo(b.x, b.y);
            }
        }
      }
      ctx!.lineWidth = 0.7 * D;
      ctx!.strokeStyle = `rgba(224,180,150,${0.42 * alpha})`;
      ctx!.stroke(near);
      ctx!.strokeStyle = `rgba(224,180,150,${0.18 * alpha})`;
      ctx!.stroke(far);
    }

    let lastBurst = -1;
    function frame(now: number) {
      const t = (now - start) / 1000;
      const round = Math.floor(t / CYCLE_S);
      const cycle = t % CYCLE_S;
      // 0-3s roam as a network · 3-5s gather · 5-10s hold · 10s burst out and roam again
      const ease = (x: number) => x * x * (3 - 2 * x);
      const pull = cycle < 3 ? 0 : cycle < 5 ? ease((cycle - 3) / 2) : cycle < 10 ? 1 : 0;
      // The burst: every point flies outward from the anchor towards the edges.
      if (cycle >= 10 && lastBurst !== round) {
        lastBurst = round;
        for (const q of parts) {
          const ang = Math.atan2(q.y - H / 2, q.x - W / 2) + (Math.random() - 0.5) * 0.9;
          const speed = (8 + Math.random() * 16) * D;
          q.vx += Math.cos(ang) * speed;
          q.vy += Math.sin(ang) * speed;
        }
      }
      const R = 90 * D;
      ctx!.clearRect(0, 0, W, H);
      drawLinks(1 - pull);
      ctx!.globalCompositeOperation = "lighter";
      for (const q of parts) {
        q.vx += (q.tx - q.x) * 0.02 * pull + Math.sin(t * 0.4 + q.seed) * 0.09 * D * (1 - pull);
        q.vy += (q.ty - q.y) * 0.02 * pull + Math.cos(t * 0.33 + q.seed) * 0.09 * D * (1 - pull);
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
        q.vx *= pull > 0 ? 0.88 : 0.94;
        q.vy *= pull > 0 ? 0.88 : 0.94;
        q.x += q.vx;
        q.y += q.vy;
        if (pull === 0) {
          // Roaming points bounce softly off the edges, so the network fills the whole hero.
          if (q.x < 0 || q.x > W) {
            q.vx *= -0.6;
            q.x = Math.min(Math.max(q.x, 0), W);
          }
          if (q.y < 0 || q.y > H) {
            q.vy *= -0.6;
            q.y = Math.min(Math.max(q.y, 0), H);
          }
        }
        ctx!.fillStyle = q.copper ? "rgba(224,162,122,0.9)" : `rgba(255,255,255,${0.3 + 0.36 * pull})`;
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
      start = performance.now() - 7000;
      lastBurst = 0;
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

import { useEffect, useRef } from 'react';

/* -------------------------------------------------------------------------- */
/*  StarfieldBackground                                                        */
/*  ─────────────────────────────────────────────────────────────────────────  */
/*  Minimal night-sky background:                                              */
/*    • A few faint static stars (no twinkle — keeps the background calm).    */
/*    • Occasional shooting stars (شهاب) that streak across the sky and       */
/*      fade out — the ONLY animated element.                                 */
/*                                                                             */
/*  Rendered behind all site content (z-index: -1, fixed) on every page.      */
/*  One canvas, one rAF loop, pauses when tab hidden, respects                */
/*  prefers-reduced-motion.                                                   */
/* -------------------------------------------------------------------------- */

interface Star {
  x: number;
  y: number;
  r: number;
  alpha: number;
}

interface Shooting {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  length: number;
  width: number;
}

export default function StarfieldBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let stars: Star[] = [];
    const shootings: Shooting[] = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let lastTs = 0;
    let nextShootAt = 0;
    let rafId = 0;
    let running = true;

    // ── Seed a sparse, calm starfield ───────────────────────────────────────
    // Lower density = calmer background. ~1 star per 18,000 px².
    const seedStars = () => {
      const target = Math.min(140, Math.floor((width * height) / 18000));
      stars = new Array(target).fill(0).map(() => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 0.3 + Math.random() * 0.7,   // small stars only — no big "lit" ones
        alpha: 0.25 + Math.random() * 0.45,
      }));
    };

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedStars();
      draw(0);
    };

    // ── Spawn a single shooting star ────────────────────────────────────────
    // Diagonal trajectory, gentle speed. 80% go down-right, 20% down-left.
    const spawnShooting = (): Shooting => {
      const fromTopRight = Math.random() < 0.2;
      const speed = 500 + Math.random() * 350; // px/sec — gentle
      const angle = Math.PI * 0.28;            // ~50° below horizontal
      const startX = fromTopRight
        ? width * (0.55 + Math.random() * 0.4)
        : width * (Math.random() * 0.45);
      return {
        x: startX,
        y: -20,
        vx: Math.cos(angle) * speed * (fromTopRight ? -1 : 1),
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 1.0 + Math.random() * 0.5,    // 1.0s - 1.5s
        length: 90 + Math.random() * 80,       // 90px - 170px trail
        width: 1.0 + Math.random() * 0.6,
      };
    };

    const drawStars = () => {
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${s.alpha})`;
        ctx.fill();
      }
    };

    const drawShootings = (dtSec: number) => {
      for (let i = shootings.length - 1; i >= 0; i--) {
        const m = shootings[i];
        m.life += dtSec;
        m.x += m.vx * dtSec;
        m.y += m.vy * dtSec;

        const t = m.life / m.maxLife;
        if (t >= 1 || m.x < -200 || m.x > width + 200 || m.y > height + 200) {
          shootings.splice(i, 1);
          continue;
        }
        // Smooth fade in → hold → fade out
        let alpha: number;
        if (t < 0.15) alpha = t / 0.15;
        else if (t < 0.55) alpha = 1;
        else alpha = 1 - (t - 0.55) / 0.45;
        alpha = Math.max(0, Math.min(1, alpha));

        // Trail: gradient from bright head to transparent tail
        const speed = Math.hypot(m.vx, m.vy);
        const tailX = m.x - (m.vx / speed) * m.length;
        const tailY = m.y - (m.vy / speed) * m.length;

        const grad = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
        grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
        grad.addColorStop(0.3, `rgba(255,255,255,${(alpha * 0.6).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');

        ctx.strokeStyle = grad;
        ctx.lineWidth = m.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();

        // Tiny bright head
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.width * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fill();
      }
    };

    const draw = (ts: number) => {
      const dtSec = lastTs === 0 ? 0 : Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      ctx.clearRect(0, 0, width, height);
      drawStars();
      drawShootings(dtSec);

      // Spawn next shooting star — slow, calm pace (every 4-9 seconds)
      if (ts >= nextShootAt) {
        nextShootAt = ts + 4000 + Math.random() * 5000;
        shootings.push(spawnShooting());
      }
    };

    const tick = (ts: number) => {
      if (!running) return;
      draw(ts);
      rafId = requestAnimationFrame(tick);
    };

    const paintStatic = () => {
      ctx.clearRect(0, 0, width, height);
      drawStars();
    };

    // ── Boot ───────────────────────────────────────────────────────────────
    resize();
    window.addEventListener('resize', resize);

    if (prefersReduced) {
      paintStatic();
    } else {
      // First shooting star comes after ~2s so the user can register the
      // calm starfield first, then sees the meteor.
      nextShootAt = performance.now() + 2000;
      rafId = requestAnimationFrame(tick);
    }

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
      } else if (!prefersReduced) {
        running = true;
        lastTs = 0;
        rafId = requestAnimationFrame(tick);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        zIndex: -1,
        pointerEvents: 'none',
        background: 'transparent',
      }}
    />
  );
}

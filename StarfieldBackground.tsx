import { useEffect, useRef } from 'react';

/* -------------------------------------------------------------------------- */
/*  StarfieldBackground                                                        */
/*  ─────────────────────────────────────────────────────────────────────────  */
/*  Calm night-sky background:                                                 */
/*    • Sparse static stars — a small fraction (~25%) breathe very slowly      */
/*      (8-14s cycle) so the sky feels alive without being distracting.       */
/*    • Occasional white shooting stars (شهاب) streak diagonally and fade.    */
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
  // Slow twinkle — only assigned to ~25% of stars. Others are fully static.
  twinkleSpeed: number; // 0 = static, otherwise radians/sec
  twinklePhase: number;
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
    // ~1 star per 16,000 px², capped so huge screens don't drown in dots.
    const seedStars = () => {
      const target = Math.min(160, Math.floor((width * height) / 16000));
      stars = new Array(target).fill(0).map(() => {
        // Only ~25% of stars twinkle — keeps the sky mostly still but
        // with subtle life. Twinkle is SLOW (8-14s full cycle) and shallow
        // (alpha varies by ±0.25 around the base) so it never demands
        // attention.
        const shouldTwinkle = Math.random() < 0.25;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          r: 0.3 + Math.random() * 0.8,
          alpha: 0.3 + Math.random() * 0.4,
          twinkleSpeed: shouldTwinkle
            ? (Math.PI * 2) / (8 + Math.random() * 6) // 8-14s period
            : 0,
          twinklePhase: Math.random() * Math.PI * 2,
        };
      });
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
      // Repaint immediately so resizing doesn't leave a blank canvas.
      // (Works for both animated and reduced-motion modes.)
      paint();
    };

    // ── Spawn a single shooting star ────────────────────────────────────────
    // 80% streak down-right, 20% down-left for variety. Gentle speed.
    const spawnShooting = (): Shooting => {
      const fromTopRight = Math.random() < 0.2;
      const speed = 450 + Math.random() * 300; // px/sec — gentle
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
        maxLife: 1.1 + Math.random() * 0.5,    // 1.1s - 1.6s
        length: 110 + Math.random() * 90,      // 110px - 200px trail
        width: 1.4 + Math.random() * 0.6,      // 1.4-2.0px (more visible)
      };
    };

    const drawStars = (dtSec: number) => {
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        let alpha = s.alpha;
        if (s.twinkleSpeed > 0) {
          s.twinklePhase += s.twinkleSpeed * dtSec;
          // Shallow modulation: ±0.25 around the base alpha.
          const modulation = (Math.sin(s.twinklePhase) + 1) / 2; // 0..1
          alpha = s.alpha * (0.7 + modulation * 0.5); // 0.7x .. 1.2x base
        }
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
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
        if (t >= 1 || m.x < -250 || m.x > width + 250 || m.y > height + 250) {
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
        grad.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
        grad.addColorStop(0.25, `rgba(255,255,255,${(alpha * 0.7).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');

        ctx.strokeStyle = grad;
        ctx.lineWidth = m.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();

        // Bright head with a faint glow halo for the "lit" meteor look
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.width * 1.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
        ctx.shadowColor = `rgba(255,255,255,${(alpha * 0.7).toFixed(3)})`;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    };

    // ── paint: pure render of current state (used by both modes) ────────────
    const paint = (ts: number = 0) => {
      const dtSec = lastTs === 0 ? 0 : Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      ctx.clearRect(0, 0, width, height);
      drawStars(prefersReduced ? 0 : dtSec);
      if (!prefersReduced) {
        drawShootings(dtSec);
      }

      // Spawn next shooting star — calm pace (every 3-7 seconds)
      if (!prefersReduced && ts >= nextShootAt) {
        nextShootAt = ts + 3000 + Math.random() * 4000;
        shootings.push(spawnShooting());
      }
    };

    const tick = (ts: number) => {
      if (!running) return;
      paint(ts);
      rafId = requestAnimationFrame(tick);
    };

    // ── Boot ───────────────────────────────────────────────────────────────
    resize();
    window.addEventListener('resize', resize);

    if (prefersReduced) {
      // No animation loop — paint once with static stars (no shooting stars).
      // resize() already calls paint() so we're covered on viewport changes.
      paint(0);
    } else {
      // First shooting star at +1.8s so the user registers the calm field
      // first, then sees the meteor.
      nextShootAt = performance.now() + 1800;
      rafId = requestAnimationFrame(tick);
    }

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
      } else if (!prefersReduced) {
        running = true;
        lastTs = 0; // reset dt so we don't get a huge jump
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

import { useEffect, useRef } from 'react';

/* -------------------------------------------------------------------------- */
/*  StarfieldBackground                                                        */
/*  ─────────────────────────────────────────────────────────────────────────  */
/*  A performant full-page animated background that paints:                     */
/*    1. A bed of static "stars" with slow, randomized twinkle.                */
/*    2. Periodic shooting stars (meteors) that streak diagonally across the   */
/*       sky, leaving a fading trail — exactly the "شهاب يجري ثم يختفي" feel.  */
/*    3. Two very soft accent-color "nebula" radial glows that drift slowly    */
/*       in the corners to give the void depth without distracting from the   */
/*       foreground content.                                                   */
/*                                                                             */
/*  Renders behind everything (z-index: -1, fixed) — one instance, on <App>.  */
/*  Respects prefers-reduced-motion (falls back to a static starfield).       */
/*  Pauses when the tab is hidden to save battery.                            */
/* -------------------------------------------------------------------------- */

interface Star {
  x: number;
  y: number;
  r: number;        // radius in px (0.3 - 1.4)
  baseAlpha: number; // 0.2 - 0.9
  twinkleSpeed: number; // radians / second
  twinklePhase: number; // initial phase
}

interface Shooting {
  x: number;
  y: number;
  vx: number;       // pixels / second
  vy: number;
  life: number;     // seconds elapsed
  maxLife: number;  // total lifetime
  length: number;   // trail length in px
  width: number;    // line width in px
  hue: 'cyan' | 'white' | 'gold';
}

const ACCENT_RGB = '6,182,212';

const HUE_RGB: Record<Shooting['hue'], string> = {
  cyan: '6,182,212',
  white: '255,255,255',
  gold: '251,191,36',
};

export default function StarfieldBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // ── Respect prefers-reduced-motion: render a static starfield once ──────
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // ── State (refs so we don't trigger re-renders) ────────────────────────
    let stars: Star[] = [];
    const shootings: Shooting[] = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let lastTs = 0;
    let nextShootAt = 0;     // timestamp (ms) when the next shooting star spawns
    let rafId = 0;
    let running = true;

    // ── Resize + (re)seed starfield based on viewport ───────────────────────
    const seedStars = () => {
      // Density: roughly 1 star per ~7,000 px², capped for big screens.
      const target = Math.min(380, Math.floor((width * height) / 7000));
      stars = new Array(target).fill(0).map(() => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 0.3 + Math.random() * 1.1,
        baseAlpha: 0.2 + Math.random() * 0.7,
        twinkleSpeed: 0.4 + Math.random() * 1.4, // rad/sec
        twinklePhase: Math.random() * Math.PI * 2,
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
      // Initial paint so the user sees stars immediately (not after 1 frame)
      draw(0);
    };

    // ── Spawn a shooting star from a random corner, diagonal trajectory ────
    const spawnShooting = (): Shooting => {
      // Pick a starting edge: top or left, then aim diagonally toward
      // bottom-right (most "natural" meteor direction). 20% chance to start
      // from top-right and head to bottom-left for variety.
      const fromTopRight = Math.random() < 0.2;
      const speed = 600 + Math.random() * 500; // px/sec
      const angle = fromTopRight
        ? Math.PI * 0.78  // down-left
        : Math.PI * 0.28; // down-right (slightly)
      const startX = fromTopRight
        ? width * (0.55 + Math.random() * 0.4)
        : width * (Math.random() * 0.45);
      const startY = -20;
      // Slight color bias toward cyan (site accent); others for variety.
      const hueRoll = Math.random();
      const hue = hueRoll < 0.55 ? 'cyan' : hueRoll < 0.85 ? 'white' : 'gold';
      return {
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed * (fromTopRight ? -1 : 1),
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.9 + Math.random() * 0.6, // 0.9s - 1.5s
        length: 80 + Math.random() * 120,   // 80px - 200px trail
        width: 1.2 + Math.random() * 0.8,
        hue,
      };
    };

    // ── Draw the soft "nebula" corner glows (drawn once per frame, cheap) ──
    const drawNebulas = (ts: number) => {
      // Two slowly-drifting radial gradients in opposite corners.
      const drift = Math.sin(ts / 9000) * 30; // very slow horizontal drift
      const g1 = ctx.createRadialGradient(
        width * 0.12 + drift, height * 0.18, 0,
        width * 0.12 + drift, height * 0.18, Math.max(width, height) * 0.45,
      );
      g1.addColorStop(0, `rgba(${ACCENT_RGB},0.08)`);
      g1.addColorStop(0.5, `rgba(${ACCENT_RGB},0.025)`);
      g1.addColorStop(1, 'rgba(6,182,212,0)');
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, width, height);

      const g2 = ctx.createRadialGradient(
        width * 0.88 - drift, height * 0.82, 0,
        width * 0.88 - drift, height * 0.82, Math.max(width, height) * 0.4,
      );
      // Very subtle teal-violet for warmth without breaking the cyan theme.
      g2.addColorStop(0, 'rgba(99,102,241,0.05)');
      g2.addColorStop(0.5, 'rgba(99,102,241,0.015)');
      g2.addColorStop(1, 'rgba(99,102,241,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, width, height);
    };

    // ── Draw the twinkling stars ───────────────────────────────────────────
    const drawStars = (dtSec: number, tsMs: number) => {
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        s.twinklePhase += s.twinkleSpeed * dtSec;
        const tw = (Math.sin(s.twinklePhase) + 1) / 2; // 0..1
        const alpha = s.baseAlpha * (0.4 + tw * 0.6);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
        ctx.fill();
        // Larger stars get a tiny accent halo for that "lit" look.
        if (s.r > 1) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 2.4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${ACCENT_RGB},${(alpha * 0.18).toFixed(3)})`;
          ctx.fill();
        }
      }
      // Tiny reference to tsMs to keep the API stable; phase is tracked per-star.
      void tsMs;
    };

    // ── Draw + advance shooting stars ──────────────────────────────────────
    const drawShootings = (dtSec: number) => {
      for (let i = shootings.length - 1; i >= 0; i--) {
        const m = shootings[i];
        m.life += dtSec;
        m.x += m.vx * dtSec;
        m.y += m.vy * dtSec;

        // Fade curve: bright in first 20%, hold, fade out in last 50%.
        const t = m.life / m.maxLife;
        if (t >= 1 || m.x < -200 || m.x > width + 200 || m.y > height + 200) {
          shootings.splice(i, 1);
          continue;
        }
        let alpha: number;
        if (t < 0.2) alpha = t / 0.2;          // fade in
        else if (t < 0.5) alpha = 1;           // hold
        else alpha = 1 - (t - 0.5) / 0.5;      // fade out
        alpha = Math.max(0, Math.min(1, alpha));

        const rgb = HUE_RGB[m.hue];
        // Trail: a gradient stroke from the meteor head (bright) back along
        // the velocity vector (fading to transparent).
        const tailX = m.x - (m.vx / Math.hypot(m.vx, m.vy)) * m.length;
        const tailY = m.y - (m.vy / Math.hypot(m.vx, m.vy)) * m.length;

        const grad = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
        grad.addColorStop(0, `rgba(${rgb},${alpha})`);
        grad.addColorStop(0.4, `rgba(${rgb},${(alpha * 0.5).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${rgb},0)`);

        ctx.strokeStyle = grad;
        ctx.lineWidth = m.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();

        // Bright head dot with soft glow
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.width * 1.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
        ctx.shadowColor = `rgba(${rgb},${alpha.toFixed(3)})`;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    };

    // ── Main draw routine ──────────────────────────────────────────────────
    const draw = (ts: number) => {
      const dtSec = lastTs === 0 ? 0 : Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      // Clear (transparent — CSS background-color shows through).
      ctx.clearRect(0, 0, width, height);

      drawNebulas(ts);
      drawStars(dtSec, ts);
      drawShootings(dtSec);

      // Maybe spawn a new shooting star
      if (ts >= nextShootAt) {
        // Average ~1 shooting every 3.5s, but randomized 2-6s for natural feel
        nextShootAt = ts + 2000 + Math.random() * 4000;
        // Occasionally spawn a small burst (2 in quick succession)
        shootings.push(spawnShooting());
        if (Math.random() < 0.18) {
          setTimeout(() => {
            if (running) shootings.push(spawnShooting());
          }, 250 + Math.random() * 400);
        }
      }
    };

    const tick = (ts: number) => {
      if (!running) return;
      draw(ts);
      rafId = requestAnimationFrame(tick);
    };

    // ── Static (reduced-motion) painter — draw once, no animation ──────────
    const paintStatic = () => {
      ctx.clearRect(0, 0, width, height);
      drawNebulas(0);
      for (const s of stars) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${s.baseAlpha.toFixed(3)})`;
        ctx.fill();
      }
    };

    // ── Boot ───────────────────────────────────────────────────────────────
    resize();
    window.addEventListener('resize', resize);

    if (prefersReduced) {
      paintStatic();
    } else {
      // First shooting star comes quickly so the user sees the effect ASAP
      nextShootAt = performance.now() + 800;
      rafId = requestAnimationFrame(tick);
    }

    // ── Pause when tab hidden, resume when visible (saves battery) ─────────
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
        // Behind everything (site content sits at z >= 0)
        zIndex: -1,
        // pointer-events:none so the canvas never blocks UI clicks
        pointerEvents: 'none',
        // Tell the browser this layer won't transform — paint-only.
        // Avoids creating a stacking context that breaks fixed children.
        background: 'transparent',
      }}
    />
  );
}

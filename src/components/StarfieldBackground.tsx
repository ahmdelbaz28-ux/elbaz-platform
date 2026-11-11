import { visualRandom } from "@/lib/random";
import { useEffect, useRef } from 'react';

/* -------------------------------------------------------------------------- */
/*  StarfieldBackground                                                        */
/*  ─────────────────────────────────────────────────────────────────────────  */
/*  Cosmic particle constellation background (inspired by streamiverse.io):    */
/*    • Moving particles (stars) that drift slowly across the canvas           */
/*    • Lines connecting nearby particles (constellation/network effect)       */
/*    • Subtle cosmic gradient glow in background                              */
/*    • Occasional shooting stars (شهاب) streak diagonally and fade          */
/*    • ~25% of particles have slow twinkle animation                          */
/*    • Modern subtle grid overlay                                             */
/*                                                                             */
/*  Rendered behind all site content (z-index: -1, fixed) on every page.      */
/*  One canvas, one rAF loop, pauses when tab hidden, respects                */
/*  prefers-reduced-motion.                                                   */
/* -------------------------------------------------------------------------- */

interface Particle {
  x: number;
  y: number;
  // Movement velocity (very slow drift)
  vx: number;
  vy: number;
  r: number;
  alpha: number;
  // Color in RGB format for gradient effects
  color: string;
  // Slow twinkle — only assigned to ~25% of particles
  twinkleSpeed: number; // 0 = static, otherwise radians/sec
  twinklePhase: number;
  // Connection state for this particle
  connectedTo: Set<number>;
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

const MAX_CONNECTION_DIST = 200; // Maximum distance for connecting lines (increased)
const MIN_CONNECTION_DIST = 60;  // Minimum distance to consider connection
const PARTICLE_SPEED = 40;        // Drift speed in pixels per second (visible movement)
const CONNECTION_ALPHA = 0.4;    // Base alpha for connection lines (increased for visibility)
// 🚀 PERF (root-cause audit, F3): particles drift at ~40px/s — 30fps is
// visually indistinguishable from 60fps but HALVES canvas CPU/GPU work.
const FRAME_INTERVAL_MS = 1000 / 30;
// ✅ FIX: Reduced particle count from 200 to 80 to prevent O(n²) performance issues.
// 200 particles = 20,000 distance checks per frame = 1.2M checks/sec at 60fps.
// 80 particles = 3,160 distance checks per frame = 190K checks/sec — 6x lighter.
// Visual impact is minimal because connection lines make it look dense.
const PARTICLE_COUNT = 80;

export default function StarfieldBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const prefersReduced =
      globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // ✅ FIX: Detect mobile devices to reduce particle count and disable
    // connection lines (the O(n²) loop is the most CPU-intensive part).
    // Desktop keeps full 80 particles + connections for a rich look.
    // Mobile gets 25 particles + NO connection lines = much smoother.
    const isMobile = globalThis !== undefined &&
      (globalThis.matchMedia?.('(max-width: 768px)').matches ||
       /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));

    // Effective particle count based on device
    const effectiveParticleCount = isMobile ? 25 : PARTICLE_COUNT;
    // Disable connections on mobile (O(n²) is too expensive for mobile CPUs)
    const enableConnections = !isMobile;
    // Disable shooting stars on mobile (saves CPU + battery)
    const enableShootingStars = !isMobile;

    // Theme detection — refined for both dark and light modes
    const getThemeColors = () => {
      return {
        isLight: false,
        // Particles: white dots
        particleColor: '255,255,255',
        // Glow particles: accent orange
        particleGlow: '249,115,22',
        // Connection lines: accent orange
        connectionColor: '249,115,22',
        // Shooting stars: accent orange
        shootingColor: '249,115,22',
        // Grid lines: using border color #4338CA (67, 56, 202)
        gridColor: 'rgba(67,56,202,0.1)',
        gridColorMajor: 'rgba(67,56,202,0.25)',
        // Cosmic gradient
        gradientFrom: 'rgba(249,115,22,0.06)',
        gradientTo: 'rgba(49,46,129,0.03)',
      };
    };
    const themeColors = getThemeColors();

    let particles: Particle[] = [];
    const shootings: Shooting[] = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let lastTs = 0;
    let nextShootAt = 0;
    let rafId = 0;
    let running = true;
    // 🚀 PERF (F3): the cosmic gradient + grid are STATIC — they never change
    // between resizes. Previously they were re-drawn EVERY frame (a full-screen
    // fillRect + a fresh createRadialGradient + ~60 stroke calls per frame at
    // 60fps = constant GPU/CPU burn behind all content). They now render once
    // into this offscreen canvas (on resize only) and are blitted per frame
    // with a single drawImage — orders of magnitude cheaper.
    let staticLayer: HTMLCanvasElement | null = null;

    // Seed particles with slow random drift
    const seedParticles = () => {
      // ✅ FIX: Use effectiveParticleCount (25 on mobile, 80 on desktop)
      const target = effectiveParticleCount;
      particles = new Array(target).fill(0).map(() => {
        const shouldTwinkle = visualRandom() < 0.25;
        // Random slow drift direction
        const angle = visualRandom() * Math.PI * 2;
        const speed = PARTICLE_SPEED * (0.5 + visualRandom() * 0.5);
        return {
          x: visualRandom() * width,
          y: visualRandom() * height,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          r: 0.8 + visualRandom() * 1.2,  // Slightly larger particles
          alpha: 0.4 + visualRandom() * 0.4,
          color: visualRandom() < 0.3 ? themeColors.particleGlow : themeColors.particleColor,
          twinkleSpeed: shouldTwinkle
            ? (Math.PI * 2) / (10 + visualRandom() * 8)
            : 0,
          twinklePhase: visualRandom() * Math.PI * 2,
          connectedTo: new Set<number>(),
        };
      });
    };

    // 🚀 PERF (F3): draw the static cosmic gradient + grid ONCE into an
    // offscreen canvas at device-pixel resolution. Redrawn on resize only.
    const renderStaticLayer = () => {
      staticLayer = document.createElement('canvas');
      staticLayer.width = canvas.width;
      staticLayer.height = canvas.height;
      const sctx = staticLayer.getContext('2d');
      if (!sctx) return;
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Cosmic gradient background — cyberpunk dark mode only
      sctx.fillStyle = 'rgba(15, 15, 35, 1)'; // Match background color
      sctx.fillRect(0, 0, width, height);

      // Subtle radial glow from top center
      const centerX = width * 0.5;
      const centerY = height * 0.2;
      const radius = Math.max(width, height) * 0.6;

      const gradient = sctx.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, radius
      );
      gradient.addColorStop(0, 'rgba(249, 115, 22, 0.08)'); // orange glow
      gradient.addColorStop(0.4, 'rgba(49, 46, 129, 0.04)'); // secondary dark blue mid
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

      sctx.fillStyle = gradient;
      sctx.fillRect(0, 0, width, height);

      // Subtle grid overlay
      const GRID_SIZE = 64;
      sctx.lineWidth = 1;
      for (let x = 0; x <= width; x += GRID_SIZE) {
        const isMajor = (x / GRID_SIZE) % 4 === 0;
        sctx.strokeStyle = isMajor ? themeColors.gridColorMajor : themeColors.gridColor;
        sctx.beginPath();
        sctx.moveTo(x + 0.5, 0);
        sctx.lineTo(x + 0.5, height);
        sctx.stroke();
      }
      for (let y = 0; y <= height; y += GRID_SIZE) {
        const isMajor = (y / GRID_SIZE) % 4 === 0;
        sctx.strokeStyle = isMajor ? themeColors.gridColorMajor : themeColors.gridColor;
        sctx.beginPath();
        sctx.moveTo(0, y + 0.5);
        sctx.lineTo(width, y + 0.5);
        sctx.stroke();
      }
    };

    const resize = () => {
      dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      width = globalThis.innerWidth;
      height = globalThis.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderStaticLayer();
      seedParticles();
      paint();
    };

    // Spawn shooting star
    const spawnShooting = (): Shooting => {
      const fromTopRight = visualRandom() < 0.2;
      const speed = 500 + visualRandom() * 350;
      const angle = Math.PI * 0.28;
      const startX = fromTopRight
        ? width * (0.55 + visualRandom() * 0.4)
        : width * (visualRandom() * 0.45);
      return {
        x: startX,
        y: -20,
        vx: Math.cos(angle) * speed * (fromTopRight ? -1 : 1),
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 1.1 + visualRandom() * 0.5,
        length: 110 + visualRandom() * 90,
        width: 1.4 + visualRandom() * 0.6,
      };
    };

    // (F3) drawCosmicGradient + drawGrid were REMOVED — both are now drawn
    // once into `staticLayer` by renderStaticLayer() and blitted in paint().

    // Update a single particle's position + twinkle alpha in place.
    // Extracted from drawParticles to keep cognitive complexity manageable.
    function updateParticlePosition(p: typeof particles[number], dtSec: number): void {
      // Slow drift movement - use dtSec for time-based animation
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;

      // Wrap around screen edges
      if (p.x < -20) p.x = width + 20;
      if (p.x > width + 20) p.x = -20;
      if (p.y < -20) p.y = height + 20;
      if (p.y > height + 20) p.y = -20;

      // Twinkle effect
      if (p.twinkleSpeed > 0) {
        p.twinklePhase += p.twinkleSpeed * dtSec;
        const modulation = (Math.sin(p.twinklePhase) + 1) / 2;
        p.alpha = (0.4 + visualRandom() * 0.4) * (0.7 + modulation * 0.5);
      }
    }

    // Update and draw particles with connections
    const drawParticles = (dtSec: number) => {
      if (prefersReduced) {
        // Static mode - just draw particles without movement
        for (const p of particles) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${p.color},${p.alpha})`;
          ctx.fill();
        }
        return;
      }

      // Update positions
      for (const p of particles) {
        updateParticlePosition(p, dtSec);
      }

      // Draw connection lines between nearby particles
      // ✅ FIX: Skip connection lines on mobile (O(n²) loop is too expensive)
      if (enableConnections) {
        drawParticleConnections(ctx, particles, themeColors.connectionColor);
      }

      // Draw particles with glow effect
      drawParticleBodies(ctx, particles, themeColors.particleGlow);
    };

    // Draw connection lines between nearby particles (extracted from drawParticles).
    function drawParticleConnections(ctx: CanvasRenderingContext2D, particlesList: typeof particles, connectionColor: string): void {
      for (let i = 0; i < particlesList.length; i++) {
        const p1 = particlesList[i];
        for (let j = i + 1; j < particlesList.length; j++) {
          const p2 = particlesList[j];
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const dist = Math.hypot(dx, dy);

          // Only connect if within range
          if (dist < MAX_CONNECTION_DIST && dist > MIN_CONNECTION_DIST) {
            // Calculate alpha based on distance (closer = more visible)
            const connectionAlpha = CONNECTION_ALPHA * (1 - dist / MAX_CONNECTION_DIST);

            // 🚀 PERF (F3): a plain rgba stroke instead of a per-line
            // createLinearGradient — gradients here were invisible at 1px
            // width but forced a gradient-object allocation for EVERY line
            // on EVERY frame (up to ~1000 allocations/sec on desktop).
            ctx.strokeStyle = `rgba(${connectionColor},${connectionAlpha.toFixed(3)})`;
            ctx.lineWidth = 1; // Increased from 0.5
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }
    }

    // Draw particle bodies with optional glow (extracted from drawParticles).
    function drawParticleBodies(ctx: CanvasRenderingContext2D, particlesList: typeof particles, particleGlow: string): void {
      for (const p of particlesList) {
        // Glow effect for brighter particles
        if (p.color === particleGlow) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${p.color},${p.alpha * 0.2})`;
          ctx.fill();
        }

        // Main particle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color},${p.alpha})`;
        ctx.fill();
      }
    }

    // Draw shooting stars
    const drawShootings = (dtSec: number) => {
      const shootRgb = themeColors.shootingColor;
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

        let alpha: number;
        if (t < 0.15) alpha = t / 0.15;
        else if (t < 0.55) alpha = 1;
        else alpha = 1 - (t - 0.55) / 0.45;
        alpha = Math.max(0, Math.min(1, alpha));

        const speed = Math.hypot(m.vx, m.vy);
        const tailX = m.x - (m.vx / speed) * m.length;
        const tailY = m.y - (m.vy / speed) * m.length;

        const grad = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
        grad.addColorStop(0, `rgba(${shootRgb},${alpha.toFixed(3)})`);
        grad.addColorStop(0.25, `rgba(${shootRgb},${(alpha * 0.7).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${shootRgb},0)`);

        ctx.strokeStyle = grad;
        ctx.lineWidth = m.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(m.x, m.y, m.width * 1.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${shootRgb},${alpha.toFixed(3)})`;
        ctx.shadowColor = `rgba(${shootRgb},${(alpha * 0.7).toFixed(3)})`;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    };

    const paint = (ts: number = 0) => {
      const dtSec = lastTs === 0 ? 0 : Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      // 🚀 PERF (F3): one drawImage replaces the per-frame gradient fills +
      // ~60 grid stroke calls (static layer is drawn in device pixels —
      // drawImage with CSS-pixel dest size under the dpr transform is exact).
      if (staticLayer) {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(staticLayer, 0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
      }

      // Draw particles with connections
      drawParticles(prefersReduced ? 0 : dtSec);

      // Draw shooting stars
      if (!prefersReduced) {
        drawShootings(dtSec);
      }

      // Spawn next shooting star (disabled on mobile for performance)
      if (enableShootingStars && !prefersReduced && ts >= nextShootAt) {
        nextShootAt = ts + 3000 + visualRandom() * 4000;
        shootings.push(spawnShooting());
      }
    };

    const tick = (ts: number) => {
      if (!running) return;
      // 🚀 PERF (F3): cap the animation to ~30fps. The drift is 40px/s — the
      // skipped frames are imperceptible, but canvas work (and the battery
      // drain behind it) drops by roughly half on every device.
      if (ts - lastTs >= FRAME_INTERVAL_MS) {
        paint(ts);
      }
      rafId = requestAnimationFrame(tick);
    };

    resize();
    globalThis.addEventListener('resize', resize);

    if (prefersReduced) {
      paint(0);
    } else {
      nextShootAt = performance.now() + 1800;
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
      globalThis.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none' }}>
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          // ✅ FIX: z-index: -1 ensures the canvas stays BEHIND all content.
          zIndex: -1,
          pointerEvents: 'none',
          // ✅ Dynamic background based on current theme
          background: '#0F0F23',
        }}
      />
    </div>
  );
}

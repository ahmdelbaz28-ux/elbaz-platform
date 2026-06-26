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

const MAX_CONNECTION_DIST = 150; // Maximum distance for connecting lines
const MIN_CONNECTION_DIST = 50;  // Minimum distance to consider connection
const PARTICLE_SPEED = 0.15;     // Very slow drift speed (px/frame)
const CONNECTION_ALPHA = 0.15;   // Base alpha for connection lines

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

    // Theme detection
    const getThemeColors = () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      return {
        isLight,
        particleColor: isLight ? '15,23,42' : '255,255,255',
        particleGlow: isLight ? '15,23,42' : '6,182,212',
        connectionColor: isLight ? '100,116,139' : '6,182,212',
        shootingColor: isLight ? '8,145,178' : '255,255,255',
        gridColor: isLight ? 'rgba(15,23,42,0.04)' : 'rgba(6,182,212,0.035)',
        gridColorMajor: isLight ? 'rgba(15,23,42,0.07)' : 'rgba(6,182,212,0.06)',
        gradientFrom: isLight ? 'rgba(241,245,249,0.3)' : 'rgba(6,182,212,0.05)',
        gradientTo: isLight ? 'rgba(226,232,240,0.1)' : 'rgba(139,92,246,0.03)',
      };
    };
    let themeColors = getThemeColors();

    const themeObserver = new MutationObserver(() => {
      themeColors = getThemeColors();
      paint(performance.now());
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    let particles: Particle[] = [];
    const shootings: Shooting[] = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let lastTs = 0;
    let nextShootAt = 0;
    let rafId = 0;
    let running = true;

    // Seed particles with slow random drift
    const seedParticles = () => {
      // Density: ~1 particle per 20,000 px²
      const target = Math.min(120, Math.floor((width * height) / 20000));
      particles = new Array(target).fill(0).map(() => {
        const shouldTwinkle = Math.random() < 0.25;
        // Random slow drift direction
        const angle = Math.random() * Math.PI * 2;
        const speed = PARTICLE_SPEED * (0.5 + Math.random() * 0.5);
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          r: 0.8 + Math.random() * 1.2,  // Slightly larger particles
          alpha: 0.4 + Math.random() * 0.4,
          color: Math.random() < 0.3 ? themeColors.particleGlow : themeColors.particleColor,
          twinkleSpeed: shouldTwinkle
            ? (Math.PI * 2) / (10 + Math.random() * 8)
            : 0,
          twinklePhase: Math.random() * Math.PI * 2,
          connectedTo: new Set<number>(),
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
      seedParticles();
      paint();
    };

    // Spawn shooting star
    const spawnShooting = (): Shooting => {
      const fromTopRight = Math.random() < 0.2;
      const speed = 500 + Math.random() * 350;
      const angle = Math.PI * 0.28;
      const startX = fromTopRight
        ? width * (0.55 + Math.random() * 0.4)
        : width * (Math.random() * 0.45);
      return {
        x: startX,
        y: -20,
        vx: Math.cos(angle) * speed * (fromTopRight ? -1 : 1),
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 1.1 + Math.random() * 0.5,
        length: 110 + Math.random() * 90,
        width: 1.4 + Math.random() * 0.6,
      };
    };

    // Draw cosmic gradient background
    const drawCosmicGradient = () => {
      // Radial gradient from center-top
      const centerX = width * 0.5;
      const centerY = height * 0.3;
      const radius = Math.max(width, height) * 0.8;
      
      const gradient = ctx.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, radius
      );
      gradient.addColorStop(0, themeColors.gradientFrom);
      gradient.addColorStop(0.5, themeColors.gradientTo);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    };

    // Draw subtle grid overlay
    const drawGrid = () => {
      const GRID_SIZE = 64;
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x += GRID_SIZE) {
        const isMajor = (x / GRID_SIZE) % 4 === 0;
        ctx.strokeStyle = isMajor ? themeColors.gridColorMajor : themeColors.gridColor;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y += GRID_SIZE) {
        const isMajor = (y / GRID_SIZE) % 4 === 0;
        ctx.strokeStyle = isMajor ? themeColors.gridColorMajor : themeColors.gridColor;
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
        ctx.stroke();
      }
    };

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
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        
        // Slow drift movement
        p.x += p.vx;
        p.y += p.vy;
        
        // Wrap around screen edges
        if (p.x < -20) p.x = width + 20;
        if (p.x > width + 20) p.x = -20;
        if (p.y < -20) p.y = height + 20;
        if (p.y > height + 20) p.y = -20;
        
        // Twinkle effect
        if (p.twinkleSpeed > 0) {
          p.twinklePhase += p.twinkleSpeed * dtSec;
          const modulation = (Math.sin(p.twinklePhase) + 1) / 2;
          p.alpha = (0.4 + Math.random() * 0.4) * (0.7 + modulation * 0.5);
        }
      }

      // Draw connection lines between nearby particles
      for (let i = 0; i < particles.length; i++) {
        const p1 = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          // Only connect if within range
          if (dist < MAX_CONNECTION_DIST && dist > MIN_CONNECTION_DIST) {
            // Calculate alpha based on distance (closer = more visible)
            const connectionAlpha = CONNECTION_ALPHA * (1 - dist / MAX_CONNECTION_DIST);
            
            // Create gradient for the connection line
            const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
            grad.addColorStop(0, `rgba(${themeColors.connectionColor},${connectionAlpha})`);
            grad.addColorStop(1, `rgba(${themeColors.connectionColor},${connectionAlpha * 0.3})`);
            
            ctx.strokeStyle = grad;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }

      // Draw particles with glow effect
      for (const p of particles) {
        // Glow effect for brighter particles
        if (p.color === themeColors.particleGlow) {
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
    };

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

      ctx.clearRect(0, 0, width, height);
      
      // Draw cosmic gradient background
      drawCosmicGradient();
      
      // Draw subtle grid
      drawGrid();
      
      // Draw particles with connections
      drawParticles(prefersReduced ? 0 : dtSec);
      
      // Draw shooting stars
      if (!prefersReduced) {
        drawShootings(dtSec);
      }

      // Spawn next shooting star
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

    resize();
    window.addEventListener('resize', resize);

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
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      themeObserver.disconnect();
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

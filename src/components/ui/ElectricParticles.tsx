import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface ElectricParticlesProps {
  color?: string;
  intensity?: "low" | "medium" | "high";
  className?: string;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  type: "spark" | "arc" | "lightning" | "pulse";
  angle: number;
  length: number;
  lifetime: number;
  speed: number;
  opacity: number;
  color: string;
}

interface Lightning {
  id: number;
  x: number;
  y: number;
  bolts: { x: number; y: number; angle: number }[];
  lifetime: number;
  maxLifetime: number;
}

export default function ElectricParticles({
  color = "#06b6d4",
  intensity = "medium",
  className = "",
}: ElectricParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const lightningsRef = useRef<Lightning[]>([]);
  const animRef = useRef<number>(0);
  const idRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ w: 0, h: 0 });

  const intensitySettings = {
    low: { spawnRate: 400, maxParticles: 40, lightningRate: 8000 },
    medium: { spawnRate: 200, maxParticles: 80, lightningRate: 5000 },
    high: { spawnRate: 100, maxParticles: 120, lightningRate: 3000 },
  };

  const settings = intensitySettings[intensity];

  useEffect(() => {
    const handleResize = () => {
      const el = canvasRef.current?.parentElement;
      if (el) {
        setDimensions({ w: el.clientWidth, h: el.clientHeight });
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  const spawnParticle = useCallback(() => {
    if (particlesRef.current.length >= settings.maxParticles) return;
    const w = dimensions.w || 800;
    const h = dimensions.h || 600;

    const types: Particle["type"][] = ["spark", "arc", "pulse", "lightning"];
    const type = types[Math.floor(Math.random() * types.length)];

    let x: number, y: number;
    if (Math.random() < 0.7) {
      x = Math.random() * w;
      y = Math.random() * h;
    } else {
      x = mouseRef.current.x + (Math.random() - 0.5) * 80;
      y = mouseRef.current.y + (Math.random() - 0.5) * 80;
    }

    const angle = Math.random() * Math.PI * 2;
    const lifetime = 20 + Math.random() * 40;
    const speed = 0.5 + Math.random() * 2.5;

    const newParticle: Particle = {
      id: idRef.current++,
      x, y, type, angle,
      length: type === "lightning" ? 20 + Math.random() * 40 : 5 + Math.random() * 15,
      lifetime,
      speed,
      opacity: 0.6 + Math.random() * 0.4,
      color,
    };
    particlesRef.current.push(newParticle);
  }, [dimensions, settings.maxParticles, color]);

  const spawnLightning = useCallback(() => {
    if (!canvasRef.current) return;
    const w = dimensions.w || 800;
    const h = dimensions.h || 600;

    const boltCount = 2 + Math.floor(Math.random() * 3);
    const bolts = [];

    let cx = w * 0.1 + Math.random() * w * 0.8;
    let cy = 0;

    for (let b = 0; b < boltCount; b++) {
      const startX = cx;
      const startY = cy;
      for (let i = 0; i < 5; i++) {
        cx += (Math.random() - 0.5) * 60;
        cy += h / boltCount / 5;
        bolts.push({ x: cx, y: cy, angle: Math.random() * Math.PI * 2 });
      }
      cx = startX + (Math.random() - 0.5) * 100;
    }

    const lightning: Lightning = {
      id: idRef.current++,
      x: w * 0.1 + Math.random() * w * 0.8,
      y: 0,
      bolts,
      lifetime: 0,
      maxLifetime: 15 + Math.random() * 10,
    };
    lightningsRef.current.push(lightning);
  }, [dimensions]);

  useEffect(() => {
    const spawnInterval = setInterval(spawnParticle, settings.spawnRate);
    const lightningInterval = setInterval(spawnLightning, settings.lightningRate);

    return () => {
      clearInterval(spawnInterval);
      clearInterval(lightningInterval);
    };
  }, [spawnParticle, spawnLightning, settings]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Update & draw particles
      particlesRef.current = particlesRef.current.filter(p => p.lifetime > 0);

      for (const p of particlesRef.current) {
        p.lifetime--;
        p.x += Math.cos(p.angle) * p.speed;
        p.y += Math.sin(p.angle) * p.speed;
        p.opacity = Math.min(1, p.lifetime / 15);

        ctx.save();
        ctx.globalAlpha = p.opacity * 0.8;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;

        if (p.type === "spark") {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
          // Spark trail
          ctx.globalAlpha = p.opacity * 0.3;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(
            p.x - Math.cos(p.angle) * p.length,
            p.y - Math.sin(p.angle) * p.length
          );
          ctx.stroke();
        } else if (p.type === "arc") {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          const arcEndX = p.x + Math.cos(p.angle + (Math.random() - 0.5) * 0.8) * p.length;
          const arcEndY = p.y + Math.sin(p.angle + (Math.random() - 0.5) * 0.8) * p.length;
          ctx.quadraticCurveTo(
            p.x + (arcEndX - p.x) * 0.5 + (Math.random() - 0.5) * 10,
            p.y + (arcEndY - p.y) * 0.5 + (Math.random() - 0.5) * 10,
            arcEndX, arcEndY
          );
          ctx.stroke();
          // Glow dot
          ctx.beginPath();
          ctx.arc(arcEndX, arcEndY, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.shadowBlur = 15;
          ctx.fill();
        } else if (p.type === "lightning") {
          ctx.lineWidth = 2;
          ctx.shadowBlur = 20;
          const endX = p.x + Math.cos(p.angle) * p.length;
          const endY = p.y + Math.sin(p.angle) * p.length;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(endX, endY);
          ctx.stroke();
          // Branch
          if (Math.random() < 0.4) {
            const branchAngle = p.angle + (Math.random() - 0.5) * 1.2;
            const branchLen = p.length * (0.3 + Math.random() * 0.4);
            ctx.globalAlpha = p.opacity * 0.5;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(
              endX + Math.cos(branchAngle) * branchLen,
              endY + Math.sin(branchAngle) * branchLen
            );
            ctx.stroke();
          }
        } else if (p.type === "pulse") {
          const radius = (1 - p.lifetime / 40) * p.length * 3;
          const alpha = p.opacity * (1 - (1 - p.lifetime / 40));
          ctx.globalAlpha = alpha * 0.6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
      }

      // Update & draw lightnings
      lightningsRef.current = lightningsRef.current.filter(l => l.lifetime < l.maxLifetime);

      for (const l of lightningsRef.current) {
        l.lifetime++;
        const alpha = Math.max(0, 1 - (l.lifetime / l.maxLifetime));
        const flashAlpha = Math.sin((l.lifetime / l.maxLifetime) * Math.PI) * 0.8;

        ctx.save();
        ctx.globalAlpha = flashAlpha;
        ctx.strokeStyle = l.bolts[0] ? "#ffffff" : "#ffffff";
        ctx.lineWidth = 3;
        ctx.shadowColor = color;
        ctx.shadowBlur = 40;

        // Draw main trunk
        if (l.bolts.length > 0) {
          ctx.beginPath();
          ctx.moveTo(l.x, l.y);
          for (const bolt of l.bolts) {
            ctx.lineTo(bolt.x, bolt.y);
          }
          ctx.stroke();

          // Glow layer
          ctx.globalAlpha = flashAlpha * 0.3;
          ctx.lineWidth = 8;
          ctx.stroke();
        }
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [color, dimensions]);

  return (
    <canvas
      ref={canvasRef}
      width={dimensions.w}
      height={dimensions.h}
      className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
      style={{ zIndex: 1 }}
      aria-hidden="true"
    />
  );
}
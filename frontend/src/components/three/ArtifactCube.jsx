/**
 * ArtifactCube — a single floating, rotating 3D validation artifact cube.
 * Glow color: blue (Trade Intent), orange (Risk Check), purple (Strategy Checkpoint).
 * Drops in from above with spring physics.
 *
 * Props:
 *   type: "TRADE_INTENT" | "RISK_CHECK" | "STRATEGY_CHECKPOINT"
 *   txHash: string
 *   timestamp: string
 *   status: string  (EXECUTED | PASSED | RECORDED | REJECTED)
 *   index: number   (used to stagger drop-in timing)
 */
import { useRef, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";

const TYPE_COLORS = {
  TRADE_INTENT:         "#00BFFF",  // electric blue
  RISK_CHECK:           "#FF8C00",  // orange
  STRATEGY_CHECKPOINT:  "#AC89FF",  // purple
  REPUTATION_UPDATE:    "#00FF88",  // neon green
};

const TYPE_LABELS = {
  TRADE_INTENT:        "TRADE",
  RISK_CHECK:          "RISK",
  STRATEGY_CHECKPOINT: "STRATEGY",
  REPUTATION_UPDATE:   "REPUTE",
};

function FloatingCube({ color, isNew }) {
  const meshRef = useRef();
  const time = useRef(Math.random() * Math.PI * 2);
  const yPos = useRef(isNew ? 4 : 0);
  const targetY = 0;

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    time.current += delta;

    // Drop-in spring animation
    yPos.current = THREE.MathUtils.lerp(yPos.current, targetY, delta * 4);

    meshRef.current.rotation.x += delta * 0.3;
    meshRef.current.rotation.y += delta * 0.5;
    meshRef.current.position.y = yPos.current + Math.sin(time.current * 0.9) * 0.08;
  });

  return (
    <mesh ref={meshRef}>
      <RoundedBox args={[1.6, 1.6, 1.6]} radius={0.12} smoothness={4}>
        <meshStandardMaterial
          color="#0a0f1a"
          transparent
          opacity={0.85}
          emissive={color}
          emissiveIntensity={0.15}
          metalness={0.3}
          roughness={0.6}
        />
      </RoundedBox>
      {/* Edge glow wireframe */}
      <mesh>
        <RoundedBox args={[1.65, 1.65, 1.65]} radius={0.12} smoothness={4}>
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.25}
            wireframe
          />
        </RoundedBox>
      </mesh>
    </mesh>
  );
}

export function ArtifactCubeCanvas({ type = "TRADE_INTENT", isNew = false, size = 90 }) {
  const color = TYPE_COLORS[type] || "#00BFFF";
  return (
    <div style={{ width: size, height: size, flexShrink: 0 }}>
      <Canvas
        camera={{ position: [0, 0, 3.2], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
        dpr={Math.min(window.devicePixelRatio, 2)}
      >
        <ambientLight intensity={0.3} />
        <pointLight position={[2, 2, 2]} intensity={1.5} color={color} />
        <pointLight position={[-2, -1, -2]} intensity={0.6} color={color} />
        <FloatingCube color={color} isNew={isNew} />
      </Canvas>
    </div>
  );
}

/**
 * ArtifactCard — full card component combining the 3D cube + artifact metadata
 */
export default function ArtifactCard({
  type = "TRADE_INTENT",
  txHash = "0xabcd...1234",
  timestamp = "2026-04-05 20:14",
  status = "EXECUTED",
  amount,
  pair,
  confidence,
  isNew = false,
  index = 0,
}) {
  const color = TYPE_COLORS[type] || "#00BFFF";
  const label = TYPE_LABELS[type] || type;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), index * 80);
    return () => clearTimeout(t);
  }, [index]);

  const statusColor =
    status === "EXECUTED" || status === "PASSED" || status === "RECORDED"
      ? "#00FF88"
      : "#FF4444";

  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        alignItems: "center",
        background: "rgba(13,17,23,0.7)",
        border: `1px solid ${color}33`,
        borderRadius: 14,
        padding: "14px 18px",
        backdropFilter: "blur(12px)",
        boxShadow: `0 0 18px ${color}15`,
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(-20px)",
        transition: "opacity 0.4s ease, transform 0.4s ease",
      }}
    >
      {/* 3D Cube */}
      <ArtifactCubeCanvas type={type} isNew={isNew} size={76} />

      {/* Metadata */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              fontWeight: 700,
              color,
              background: `${color}20`,
              border: `1px solid ${color}40`,
              borderRadius: 999,
              padding: "2px 8px",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              fontWeight: 700,
              color: statusColor,
              background: `${statusColor}15`,
              border: `1px solid ${statusColor}40`,
              borderRadius: 999,
              padding: "2px 8px",
            }}
          >
            {status}
          </span>
        </div>

        {pair && (
          <p style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: "#f9f5fd", margin: "0 0 2px" }}>
            {pair}{amount && ` · $${amount}`}
            {confidence && <span style={{ color, fontSize: 12, marginLeft: 6 }}>{confidence}% conf</span>}
          </p>
        )}

        <p
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: "#00BFFF",
            margin: "4px 0 2px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {txHash}
        </p>
        <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#6b7280", margin: 0 }}>
          {timestamp}
        </p>
      </div>
    </div>
  );
}

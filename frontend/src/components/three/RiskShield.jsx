/**
 * RiskShield — animated 3D shield for the Vault / Risk Router panel.
 * Props:
 *   drawdownPct: number  (0–100)
 *   dangerThreshold: number (default 15)
 *   size: number  (canvas height, default 260)
 */
import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

function Shield({ drawdownPct = 0, dangerThreshold = 15 }) {
  const groupRef = useRef();
  const shieldRef = useRef();
  const hexRingRef = useRef();
  const time = useRef(0);

  const isDanger = drawdownPct >= dangerThreshold;
  const isWarning = !isDanger && drawdownPct >= dangerThreshold * 0.6;

  const primaryColor = isDanger ? "#FF4444" : isWarning ? "#FFB800" : "#00FF88";
  const emissiveInt = isDanger ? 0.5 : 0.25;

  // Build hexagonal grid pattern on shield face
  const hexPositions = useMemo(() => {
    const pts = [];
    const rows = 5, cols = 5;
    for (let r = -rows; r <= rows; r++) {
      for (let c = -cols; c <= cols; c++) {
        const x = c * 0.28 + (r % 2) * 0.14;
        const y = r * 0.24;
        if (Math.abs(x) < 0.9 && Math.sqrt(x * x + (y * 0.85) * (y * 0.85)) < 0.85) {
          pts.push([x, y]);
        }
      }
    }
    return pts;
  }, []);

  useFrame((state, delta) => {
    time.current += delta;
    if (!groupRef.current) return;

    groupRef.current.rotation.y = Math.sin(time.current * 0.4) * 0.3;
    groupRef.current.position.y = Math.sin(time.current * 0.8) * 0.05;

    if (shieldRef.current) {
      // Pulse scale when in danger
      if (isDanger) {
        const crack = 1 + Math.sin(time.current * 8) * 0.015;
        shieldRef.current.scale.setScalar(crack);
      } else {
        const pulse = 1 + Math.sin(time.current * 2) * 0.02;
        shieldRef.current.scale.setScalar(pulse);
      }
    }

    if (hexRingRef.current) {
      hexRingRef.current.rotation.z += delta * (isDanger ? 1.2 : 0.3);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Shield body — custom shield shape via lathe */}
      <group ref={shieldRef}>
        {/* Main shield face */}
        <mesh position={[0, 0, -0.05]}>
          <cylinderGeometry args={[0.9, 0.5, 0.12, 6]} />
          <meshStandardMaterial
            color="#0d1117"
            emissive={primaryColor}
            emissiveIntensity={emissiveInt * 0.3}
            metalness={0.7}
            roughness={0.3}
          />
        </mesh>

        {/* Outer ring */}
        <mesh position={[0, 0, 0]}>
          <torusGeometry args={[0.92, 0.06, 6, 6]} />
          <meshBasicMaterial color={primaryColor} transparent opacity={0.9} />
        </mesh>

        {/* Inner dot */}
        <mesh position={[0, 0, 0.1]}>
          <circleGeometry args={[0.2, 12]} />
          <meshBasicMaterial color={primaryColor} transparent opacity={0.8} />
        </mesh>

        {/* Hex grid dots */}
        {hexPositions.map(([x, y], i) => (
          <mesh key={i} position={[x, y, 0.12]}>
            <circleGeometry args={[0.04, 6]} />
            <meshBasicMaterial
              color={primaryColor}
              transparent
              opacity={isDanger ? 0.7 : 0.35}
            />
          </mesh>
        ))}

        {/* Crack lines when in danger */}
        {isDanger && [
          [[0.1, 0.3, 0.15], [0.4, -0.2, 0.15]],
          [[-0.15, 0.1, 0.15], [-0.5, 0.35, 0.15]],
          [[0.05, -0.1, 0.15], [0.3, -0.5, 0.15]],
        ].map((pts, i) => (
          <line key={i}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[new Float32Array(pts.flat()), 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial color="#FF4444" transparent opacity={0.8} />
          </line>
        ))}
      </group>

      {/* Rotating hex ring outside */}
      <group ref={hexRingRef}>
        <mesh>
          <torusGeometry args={[1.15, 0.025, 6, 6]} />
          <meshBasicMaterial color={primaryColor} transparent opacity={0.5} />
        </mesh>
      </group>

      {/* Glow particle ring */}
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(angle) * 1.18, Math.sin(angle) * 1.18, 0]}>
            <sphereGeometry args={[0.04, 6, 6]} />
            <meshBasicMaterial color={primaryColor} transparent opacity={0.7} />
          </mesh>
        );
      })}
    </group>
  );
}

export default function RiskShield({
  drawdownPct = 0,
  dangerThreshold = 15,
  size = 260,
}) {
  const isDanger = drawdownPct >= dangerThreshold;
  const isWarning = !isDanger && drawdownPct >= dangerThreshold * 0.6;
  const statusText = isDanger
    ? "⛔ CIRCUIT BREAKER"
    : isWarning
    ? "⚠ ELEVATED RISK"
    : "🛡 PROTECTED";
  const statusColor = isDanger ? "#FF4444" : isWarning ? "#FFB800" : "#00FF88";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        <Canvas
          camera={{ position: [0, 0, 3], fov: 45 }}
          gl={{ antialias: true, alpha: true }}
          dpr={Math.min(window.devicePixelRatio, 2)}
        >
          <ambientLight intensity={0.4} />
          <pointLight position={[2, 3, 2]} intensity={1.5} />
          <Shield drawdownPct={drawdownPct} dangerThreshold={dangerThreshold} />
        </Canvas>
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          fontWeight: 700,
          color: statusColor,
          background: `${statusColor}18`,
          border: `1px solid ${statusColor}40`,
          borderRadius: 999,
          padding: "4px 14px",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {statusText}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          color: "#6b7280",
        }}
      >
        Drawdown: <span style={{ color: statusColor, fontWeight: 700 }}>{drawdownPct.toFixed(1)}%</span> / {dangerThreshold}% limit
      </div>
    </div>
  );
}

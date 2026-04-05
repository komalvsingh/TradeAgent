/**
 * ReputationChart3D — floating 3D bar chart for reputation timeline.
 * Green bars = profitable trades, Red = losses.
 * Camera slowly orbits. Bars animate up on mount.
 * Accepts `trades` prop: [{ profitable, pnl, score }]
 */
import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";

const DEFAULT_TRADES = Array.from({ length: 12 }, (_, i) => ({
  profitable: i % 3 !== 0,
  pnl: i % 3 !== 0 ? Math.random() * 80 + 10 : -(Math.random() * 40 + 5),
  score: 50 + (i % 3 !== 0 ? i * 3 : -i * 2),
}));

function Bar({ x, height, color, targetHeight, label }) {
  const meshRef = useRef();
  const currentHeight = useRef(0.01);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    currentHeight.current = THREE.MathUtils.lerp(
      currentHeight.current,
      targetHeight,
      delta * 2.5
    );
    meshRef.current.scale.y = currentHeight.current;
    meshRef.current.position.y = currentHeight.current / 2;
  });

  return (
    <group position={[x, 0, 0]}>
      <mesh ref={meshRef}>
        <boxGeometry args={[0.55, 1, 0.55]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.85}
          emissive={color}
          emissiveIntensity={0.3}
        />
      </mesh>
    </group>
  );
}

function Chart({ trades }) {
  const groupRef = useRef();

  const maxH = 2.5;
  const bars = useMemo(() => {
    const maxPnl = Math.max(...trades.map((t) => Math.abs(t.pnl)), 1);
    return trades.map((trade, i) => ({
      x: (i - trades.length / 2) * 0.8,
      targetHeight: Math.max(0.08, (Math.abs(trade.pnl) / maxPnl) * maxH),
      color: trade.profitable ? "#00FF88" : "#FF4444",
      label: trade.profitable ? `+${trade.pnl.toFixed(0)}` : `${trade.pnl.toFixed(0)}`,
    }));
  }, [trades]);

  return (
    <group ref={groupRef} position={[0, -1.2, 0]}>
      {/* Floor grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[trades.length * 0.8 + 1, 4]} />
        <meshBasicMaterial color="#0D1117" transparent opacity={0.4} />
      </mesh>

      {/* Grid lines */}
      {[0.5, 1.0, 1.5, 2.0, 2.5].map((h) => (
        <mesh key={h} position={[0, h, -0.4]} rotation={[0, 0, 0]}>
          <planeGeometry args={[trades.length * 0.8 + 1, 0.005]} />
          <meshBasicMaterial color="#1a3a4a" transparent opacity={0.5} />
        </mesh>
      ))}

      {/* Bars */}
      {bars.map((bar, i) => (
        <Bar key={i} {...bar} />
      ))}
    </group>
  );
}

export default function ReputationChart3D({ trades = DEFAULT_TRADES, height = 320 }) {
  return (
    <div
      style={{
        width: "100%",
        height,
        borderRadius: 16,
        overflow: "hidden",
        background: "rgba(13,17,23,0.6)",
      }}
    >
      <Canvas
        camera={{ position: [0, 2, 8], fov: 50 }}
        gl={{ antialias: true, alpha: true }}
        dpr={Math.min(window.devicePixelRatio, 2)}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 8, 5]} intensity={1.2} color="#ffffff" />
        <pointLight position={[0, 4, 0]} intensity={0.8} color="#00FF88" distance={10} />
        <Chart trades={trades} />
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          autoRotate
          autoRotateSpeed={0.7}
          minPolarAngle={Math.PI * 0.2}
          maxPolarAngle={Math.PI * 0.55}
        />
      </Canvas>
    </div>
  );
}

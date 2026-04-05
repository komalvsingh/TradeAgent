/**
 * IdentityGlobe — rotating 3D sphere of ERC-8004 identity nodes.
 * My agent's node sits at the center and pulses bright green.
 * Other identity nodes orbit around on the sphere surface.
 */
import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Sphere, Line } from "@react-three/drei";
import * as THREE from "three";

const NODE_COUNT = 28;

function fibonacci_sphere(n) {
  const points = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    points.push([r * Math.cos(theta), y, r * Math.sin(theta)]);
  }
  return points;
}

function GlobeNodes() {
  const groupRef = useRef();
  const centerRef = useRef();
  const time = useRef(0);

  const nodes = useMemo(() => fibonacci_sphere(NODE_COUNT), []);

  // Build edges between nearby nodes
  const edges = useMemo(() => {
    const edgeList = [];
    const RADIUS = 1.8;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i][0] - nodes[j][0];
        const dy = nodes[i][1] - nodes[j][1];
        const dz = nodes[i][2] - nodes[j][2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 0.75) {
          edgeList.push([
            [nodes[i][0] * RADIUS, nodes[i][1] * RADIUS, nodes[i][2] * RADIUS],
            [nodes[j][0] * RADIUS, nodes[j][1] * RADIUS, nodes[j][2] * RADIUS],
          ]);
        }
      }
    }
    return edgeList;
  }, [nodes]);

  useFrame((state, delta) => {
    time.current += delta;
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.18;
      groupRef.current.rotation.x = Math.sin(time.current * 0.12) * 0.1;
    }
    if (centerRef.current) {
      const pulse = 0.85 + Math.sin(time.current * 3) * 0.15;
      centerRef.current.scale.setScalar(pulse);
    }
  });

  const RADIUS = 1.8;

  return (
    <group ref={groupRef}>
      {/* Translucent sphere shell */}
      <Sphere args={[RADIUS, 32, 32]}>
        <meshBasicMaterial
          color="#001a2e"
          transparent
          opacity={0.12}
          wireframe={false}
          side={THREE.BackSide}
        />
      </Sphere>

      {/* Wireframe grid */}
      <Sphere args={[RADIUS * 1.001, 24, 16]}>
        <meshBasicMaterial
          color="#004466"
          transparent
          opacity={0.08}
          wireframe
        />
      </Sphere>

      {/* Connection edges */}
      {edges.map((edge, i) => (
        <Line
          key={i}
          points={edge}
          color="#00BFFF"
          transparent
          opacity={0.25}
          lineWidth={0.5}
        />
      ))}

      {/* Identity nodes on sphere surface */}
      {nodes.map((pos, i) => (
        <mesh
          key={i}
          position={[pos[0] * RADIUS, pos[1] * RADIUS, pos[2] * RADIUS]}
        >
          <sphereGeometry args={[0.045, 8, 8]} />
          <meshBasicMaterial color="#00BFFF" transparent opacity={0.9} />
        </mesh>
      ))}

      {/* My agent — central pulsing green node */}
      <mesh ref={centerRef} position={[0, 0, 0]}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshBasicMaterial color="#00FF88" transparent opacity={1} />
      </mesh>

      {/* Glow ring around center */}
      <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.28, 0.015, 8, 64]} />
        <meshBasicMaterial color="#00FF88" transparent opacity={0.5} />
      </mesh>

      {/* Lines from center to nearby nodes */}
      {nodes.slice(0, 8).map((pos, i) => (
        <Line
          key={`center-${i}`}
          points={[
            [0, 0, 0],
            [pos[0] * RADIUS * 0.6, pos[1] * RADIUS * 0.6, pos[2] * RADIUS * 0.6],
          ]}
          color="#00FF88"
          transparent
          opacity={0.3}
          lineWidth={0.7}
        />
      ))}
    </group>
  );
}

export default function IdentityGlobe({ height = 380 }) {
  return (
    <div style={{ width: "100%", height, borderRadius: 16, overflow: "hidden" }}>
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        dpr={Math.min(window.devicePixelRatio, 2)}
      >
        <ambientLight intensity={0.4} />
        <GlobeNodes />
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          autoRotate
          autoRotateSpeed={0.4}
          minPolarAngle={Math.PI * 0.25}
          maxPolarAngle={Math.PI * 0.75}
        />
      </Canvas>
    </div>
  );
}

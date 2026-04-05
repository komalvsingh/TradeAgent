/**
 * NeuralBackground — full-page animated particle network as a page backdrop.
 * Uses instanced meshes for performance (single draw call for all particles).
 * Particles speed up when agentActive=true.
 */
import { useRef, useMemo, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const PARTICLE_COUNT = 120;
const CONNECTION_DIST = 2.2;
const BOUNDS = 8;

function Particles({ agentActive }) {
  const meshRef = useRef();
  const linesRef = useRef();

  // Generate stable initial positions
  const positions = useMemo(() => {
    const pos = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pos.push(
        (Math.random() - 0.5) * BOUNDS * 2,
        (Math.random() - 0.5) * BOUNDS * 2,
        (Math.random() - 0.5) * BOUNDS * 2
      );
    }
    return new Float32Array(pos);
  }, []);

  const velocities = useMemo(() => {
    const vel = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      vel.push(
        (Math.random() - 0.5) * 0.008,
        (Math.random() - 0.5) * 0.008,
        (Math.random() - 0.5) * 0.008
      );
    }
    return vel;
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const linePositions = useMemo(
    () => new Float32Array(PARTICLE_COUNT * PARTICLE_COUNT * 6),
    []
  );
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
    return g;
  }, [linePositions]);

  const flatPos = useMemo(() => [...positions], [positions]);

  useFrame(() => {
    if (!meshRef.current) return;
    const speed = agentActive ? 2.5 : 1.0;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const ix = i * 3;
      flatPos[ix]     += velocities[i * 3]     * speed;
      flatPos[ix + 1] += velocities[i * 3 + 1] * speed;
      flatPos[ix + 2] += velocities[i * 3 + 2] * speed;

      // Bounce off bounds
      for (let d = 0; d < 3; d++) {
        if (Math.abs(flatPos[ix + d]) > BOUNDS) {
          velocities[i * 3 + d] *= -1;
          flatPos[ix + d] = Math.sign(flatPos[ix + d]) * BOUNDS;
        }
      }

      dummy.position.set(flatPos[ix], flatPos[ix + 1], flatPos[ix + 2]);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;

    // Draw connection lines
    if (!linesRef.current) return;
    let lineIdx = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      for (let j = i + 1; j < PARTICLE_COUNT; j++) {
        const dx = flatPos[i * 3] - flatPos[j * 3];
        const dy = flatPos[i * 3 + 1] - flatPos[j * 3 + 1];
        const dz = flatPos[i * 3 + 2] - flatPos[j * 3 + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < CONNECTION_DIST && lineIdx + 6 <= linePositions.length) {
          linePositions[lineIdx++] = flatPos[i * 3];
          linePositions[lineIdx++] = flatPos[i * 3 + 1];
          linePositions[lineIdx++] = flatPos[i * 3 + 2];
          linePositions[lineIdx++] = flatPos[j * 3];
          linePositions[lineIdx++] = flatPos[j * 3 + 1];
          linePositions[lineIdx++] = flatPos[j * 3 + 2];
        }
      }
    }
    // Zero out unused line segments
    for (let k = lineIdx; k < linePositions.length; k++) linePositions[k] = 0;
    linesRef.current.geometry.attributes.position.needsUpdate = true;
    linesRef.current.geometry.setDrawRange(0, lineIdx / 3);
  });

  return (
    <>
      <instancedMesh ref={meshRef} args={[null, null, PARTICLE_COUNT]}>
        <sphereGeometry args={[0.04, 6, 6]} />
        <meshBasicMaterial color="#00BFFF" transparent opacity={0.6} />
      </instancedMesh>
      <lineSegments ref={linesRef} geometry={lineGeo}>
        <lineBasicMaterial color="#0066aa" transparent opacity={0.18} />
      </lineSegments>
    </>
  );
}

export default function NeuralBackground({ agentActive = false }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        opacity: 0.7,
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 12], fov: 60 }}
        gl={{ antialias: false, alpha: true }}
        dpr={Math.min(window.devicePixelRatio, 1.5)}
      >
        <Particles agentActive={agentActive} />
      </Canvas>
    </div>
  );
}

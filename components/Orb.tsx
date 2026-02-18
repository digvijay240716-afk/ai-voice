import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Emotion } from '../types';

interface OrbProps {
  state: 'idle' | 'listening' | 'speaking' | 'thinking';
  analyser?: AnalyserNode | null;
  emotion?: Emotion;
}

// --- Shader Code ---

const vertexShader = `
uniform float uTime;
uniform float uAmplitude;
uniform float uFrequencyHigh;
uniform float uFrequencyMid;
uniform float uFrequencyLow;
varying float vDisplacement;
varying vec3 vPosition;

// Simplex Noise 3D function
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 = v - i + dot(i, C.xxx) ;

  // Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );

  //   x0 = x0 - 0.0 + 0.0 * C.xxx;
  //   x1 = x0 - i1  + 1.0 * C.xxx;
  //   x2 = x0 - i2  + 2.0 * C.xxx;
  //   x3 = x0 - 1.0 + 3.0 * C.xxx;
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
  vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y

  // Permutations
  i = mod289(i);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

  // Gradients: 7x7x6 points over a cube, mapped onto a 4-hedron.
  // The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)
  float n_ = 0.142857142857; // 1.0/7.0
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );

  //vec4 s0 = vec4(lessThan(b0,0.0))*2.0 - 1.0;
  //vec4 s1 = vec4(lessThan(b1,0.0))*2.0 - 1.0;
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

  //Normalise gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  // Mix final noise value
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 105.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                dot(p2,x2), dot(p3,x3) ) );
}

void main() {
  vPosition = position;
  
  // Base breathing
  float breath = sin(uTime * 0.5) * 0.05;
  
  // Audio reactivity
  // High freq = fine ripples, Low freq = broad waves
  float noiseHigh = snoise(position * 4.0 + uTime * 3.0) * uFrequencyHigh * 0.1;
  float noiseMid = snoise(position * 2.0 + uTime * 1.5) * uFrequencyMid * 0.2;
  float noiseLow = snoise(position * 0.5 + uTime * 0.5) * uFrequencyLow * 0.3;
  
  // Combine noise with amplitude
  float totalDisplacement = breath + (noiseHigh + noiseMid + noiseLow) * uAmplitude;
  
  vDisplacement = totalDisplacement;
  
  vec3 newPosition = position + normal * totalDisplacement;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
  
  // Size attenuation for particles
  gl_PointSize = 2.0 * (1.0 + uAmplitude * 2.0); 
}
`;

const fragmentShader = `
uniform vec3 uColor;
uniform float uTime;
varying float vDisplacement;
varying vec3 vPosition;

void main() {
  // Circular particle shape
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;
  
  // Soft glow edge
  float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
  
  // Color variation based on displacement/position
  vec3 finalColor = uColor + vDisplacement * 0.5;
  
  // Add subtle sparkle
  float sparkle = sin(vPosition.x * 10.0 + uTime * 5.0) * 0.1;
  finalColor += sparkle;

  gl_FragColor = vec4(finalColor, alpha * 0.8);
}
`;

// --- Emotion Color Map ---
const getEmotionColor = (emotion?: Emotion) => {
  switch (emotion) {
    case Emotion.Low: return new THREE.Color(0.2, 0.2, 0.6); // Deep sad blue
    case Emotion.Stressed: return new THREE.Color(0.7, 0.3, 0.2); // Warm reddish tint
    case Emotion.Neutral: return new THREE.Color(0.4, 0.3, 0.8); // Base purple
    case Emotion.Good: return new THREE.Color(0.2, 0.8, 0.7); // Bright teal/cyan
    case Emotion.Overwhelmed: return new THREE.Color(0.8, 0.2, 0.5); // Intense pink/purple
    default: return new THREE.Color(0.5, 0.2, 0.9); // Default purple
  }
};

const ParticleSphere = ({ analyser, emotion, state }: { analyser?: AnalyserNode | null, emotion?: Emotion, state: string }) => {
  const mesh = useRef<THREE.Points>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  
  // Memoize uniforms so they aren't recreated on re-renders,
  // preventing the color from resetting to the default state abruptly.
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: getEmotionColor(Emotion.Neutral) },
    uAmplitude: { value: 0 },
    uFrequencyHigh: { value: 0 },
    uFrequencyMid: { value: 0 },
    uFrequencyLow: { value: 0 }
  }), []);
  
  // Geometry: High vertex count for smooth particles
  const geometry = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1.8, 30); // Radius 1.8, Detail 30
    return geo;
  }, []);

  // Audio Data Arrays
  const dataArray = useMemo(() => new Uint8Array(analyser ? analyser.frequencyBinCount : 0), [analyser]);

  useFrame((stateObj) => {
    if (!material.current) return;
    
    // Update Time
    material.current.uniforms.uTime.value = stateObj.clock.elapsedTime;
    
    // Smooth color transition
    // Reduced lerp factor to 0.02 for smoother, more fluid transition
    const targetColor = getEmotionColor(emotion);
    const currentColor = material.current.uniforms.uColor.value;
    currentColor.lerp(targetColor, 0.02);
    
    // Audio Analysis
    let amp = 0;
    let high = 0;
    let mid = 0;
    let low = 0;
    
    if (analyser) {
        // Only update data array if analyser exists
        if (dataArray.length !== analyser.frequencyBinCount) {
             // Reallocate if size mismatch (rare but possible if ctx changes)
        }
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate averages
        const length = dataArray.length;
        let sum = 0;
        let sumLow = 0;
        let sumMid = 0;
        let sumHigh = 0;
        
        // Simple band split (approximate)
        const lowBound = Math.floor(length * 0.1);
        const midBound = Math.floor(length * 0.5);
        
        for(let i = 0; i < length; i++) {
            const val = dataArray[i] / 255.0; // Normalize 0-1
            sum += val;
            if (i < lowBound) sumLow += val;
            else if (i < midBound) sumMid += val;
            else sumHigh += val;
        }
        
        amp = sum / length; // Avg amplitude
        low = sumLow / lowBound;
        mid = sumMid / (midBound - lowBound);
        high = sumHigh / (length - midBound);
        
        // Boost values for visual impact
        amp *= 2.0;
        low *= 1.5;
        mid *= 1.2;
        high *= 2.0;

    } else {
        // Idle / Thinking simulation
        if (state === 'thinking') {
            const t = stateObj.clock.elapsedTime;
            amp = 0.2 + Math.sin(t * 5) * 0.1;
            mid = 0.3 + Math.cos(t * 3) * 0.1;
        } else if (state === 'speaking') {
             // Fallback if no analyser but speaking (rare with updated App)
             const t = stateObj.clock.elapsedTime;
             amp = 0.3 + Math.sin(t * 15) * 0.2;
        } else {
             // Idle breathing
             amp = 0.05; 
        }
    }

    // Update Uniforms with smoothing
    const u = material.current.uniforms;
    u.uAmplitude.value = THREE.MathUtils.lerp(u.uAmplitude.value, amp, 0.1);
    u.uFrequencyLow.value = THREE.MathUtils.lerp(u.uFrequencyLow.value, low, 0.1);
    u.uFrequencyMid.value = THREE.MathUtils.lerp(u.uFrequencyMid.value, mid, 0.1);
    u.uFrequencyHigh.value = THREE.MathUtils.lerp(u.uFrequencyHigh.value, high, 0.1);
    
    // Rotation
    if (mesh.current) {
        mesh.current.rotation.y += 0.001 + (amp * 0.01);
        mesh.current.rotation.z = Math.sin(stateObj.clock.elapsedTime * 0.2) * 0.1;
    }
  });

  return (
    <points ref={mesh} geometry={geometry}>
      <shaderMaterial
        ref={material}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent={true}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={uniforms}
      />
    </points>
  );
};

const Orb: React.FC<OrbProps> = ({ state, analyser, emotion }) => {
  return (
    <div className="w-full h-96 relative opacity-0 animate-[fadeIn_1s_ease-out_forwards]">
      <Canvas 
        camera={{ position: [0, 0, 5], fov: 60 }} 
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={0.5} />
        <ParticleSphere analyser={analyser} emotion={emotion} state={state} />
      </Canvas>
      {/* Fallback CSS Glow for atmosphere */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-purple-900/30 rounded-full blur-3xl -z-10 pointer-events-none mix-blend-screen" />
    </div>
  );
};

export default Orb;
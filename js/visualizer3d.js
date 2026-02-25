/**
 * SyncWave 3D Visualizer — Three.js audio-reactive sphere
 * Adapted from filipz's CodePen (Three.js + Audio Visualizer)
 * Colors remapped to cyberpunk cyan/magenta palette
 * Hooks into our existing player.js analyser node
 */

import { getAnalyser } from './player.js';

let THREE = null;
let OrbitControls = null;
let container = null;
let scene, camera, renderer, controls;
let anomalyGroup = null;
let updateGlow = null;
let updateParticles = null;
let clock = null;
let animationId = null;
let frequencyData = null;
let circularCanvas = null;
let circularCtx = null;
let resizeHandler = null;
let resizeObserver = null;

// Performance: detect low-end hardware
const isLowEnd = navigator.hardwareConcurrency <= 4 || /mobile|android/i.test(navigator.userAgent);
const PARTICLE_COUNT = isLowEnd ? 800 : 2000;
const ICO_DETAIL = isLowEnd ? 3 : 4;
const GLOW_SEGMENTS = isLowEnd ? 20 : 32;
const MAX_PIXEL_RATIO = isLowEnd ? 1 : 2;

// ─── PUBLIC API ──────────────────────────────────────────

export async function initVisualizer3D(containerEl) {
  container = containerEl;

  // Dynamically load Three.js so a CDN failure doesn't break the whole app
  try {
    [THREE, { OrbitControls }] = await Promise.all([
      import('three'),
      import('three/addons/controls/OrbitControls.js'),
    ]);
  } catch (e) {
    console.warn('Three.js failed to load — 3D visualizer disabled:', e.message);
    return false;
  }

  // Ensure container is positioned for absolute children
  container.style.position = 'relative';

  initThreeJS();
  initCircularOverlay();
  clock = new THREE.Clock();
  return true;
}

export function startVisualizer3D() {
  if (animationId) return;
  animate();
}

export function stopVisualizer3D() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

export function destroyVisualizer3D() {
  stopVisualizer3D();

  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  // Dispose all scene geometries and materials to prevent GPU memory leaks
  if (scene) {
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }

  if (renderer) {
    renderer.dispose();
    renderer.forceContextLoss();
    if (renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    renderer = null;
  }

  if (circularCanvas && circularCanvas.parentNode) {
    circularCanvas.parentNode.removeChild(circularCanvas);
    circularCanvas = null;
    circularCtx = null;
  }

  if (controls) {
    controls.dispose();
    controls = null;
  }

  scene = null;
  camera = null;
  anomalyGroup = null;
  updateGlow = null;
  updateParticles = null;
  clock = null;
  container = null;
  frequencyData = null;
}

// ─── THREE.JS SCENE ──────────────────────────────────────

function initThreeJS() {
  const w = container.clientWidth;
  const h = container.clientHeight;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050510, 0.04);

  camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
  camera.position.set(0, 0, 8);

  renderer = new THREE.WebGLRenderer({
    antialias: !isLowEnd,
    alpha: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setSize(w, h);
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.inset = '0';
  container.appendChild(renderer.domElement);

  // OrbitControls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.rotateSpeed = 0.4;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.minDistance = 4;
  controls.maxDistance = 20;

  // Lights
  scene.add(new THREE.AmbientLight(0x404040, 1.5));

  const dl = new THREE.DirectionalLight(0xffffff, 1.2);
  dl.position.set(1, 1, 1);
  scene.add(dl);

  const pl1 = new THREE.PointLight(0x00f0ff, 1, 12); // cyan
  pl1.position.set(3, 2, 2);
  scene.add(pl1);

  const pl2 = new THREE.PointLight(0xff00aa, 0.8, 12); // magenta
  pl2.position.set(-3, -2, -2);
  scene.add(pl2);

  // Create objects
  updateGlow = createAnomalyObject();
  updateParticles = createBackgroundParticles();

  // Resize on window resize and container resize (panel collapse/expand)
  resizeHandler = () => onResize();
  window.addEventListener('resize', resizeHandler);
  resizeObserver = new ResizeObserver(() => onResize());
  resizeObserver.observe(container);
}

function onResize() {
  if (!container || !camera || !renderer) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);

  if (circularCanvas) {
    circularCanvas.width = w;
    circularCanvas.height = h;
  }
}

// ─── ANOMALY OBJECT (wireframe icosahedron + glow) ───────

function createAnomalyObject() {
  if (anomalyGroup) scene.remove(anomalyGroup);
  anomalyGroup = new THREE.Group();

  const radius = 2;

  // Outer wireframe sphere with simplex noise distortion
  const outerGeo = new THREE.IcosahedronGeometry(radius, ICO_DETAIL);
  const outerMat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      color: { value: new THREE.Color(0x00f0ff) },
      audioLevel: { value: 0 },
      distortion: { value: 1.0 },
    },
    vertexShader: `
      uniform float time;
      uniform float audioLevel;
      uniform float distortion;
      varying vec3 vNormal;
      varying vec3 vPosition;

      // Simplex noise
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
      vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

      float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        i = mod289(i);
        vec4 p = permute(permute(permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0))
              + i.y + vec4(0.0, i1.y, i2.y, 1.0))
              + i.x + vec4(0.0, i1.x, i2.x, 1.0));
        float n_ = 0.142857142857;
        vec3 ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);
        vec4 x = x_ * ns.x + ns.yyyy;
        vec4 y = y_ * ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);
        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
      }

      void main() {
        vNormal = normalize(normalMatrix * normal);
        float slowTime = time * 0.3;
        vec3 pos = position;
        float noise = snoise(vec3(pos.x * 0.5, pos.y * 0.5, pos.z * 0.5 + slowTime));
        pos += normal * noise * 0.25 * distortion * (1.0 + audioLevel * 1.5);
        vPosition = pos;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform vec3 color;
      uniform float audioLevel;
      varying vec3 vNormal;
      varying vec3 vPosition;

      void main() {
        vec3 viewDir = normalize(cameraPosition - vPosition);
        float fresnel = 1.0 - max(0.0, dot(viewDir, vNormal));
        fresnel = pow(fresnel, 2.0 + audioLevel * 2.0);
        float pulse = 0.8 + 0.2 * sin(time * 2.0);

        // Blend cyan → magenta based on audio
        vec3 cyan = vec3(0.0, 0.94, 1.0);
        vec3 magenta = vec3(1.0, 0.0, 0.67);
        vec3 baseColor = mix(cyan, magenta, audioLevel * 0.7 + 0.15);

        vec3 finalColor = baseColor * fresnel * pulse * (1.0 + audioLevel * 0.8);
        float alpha = fresnel * (0.7 - audioLevel * 0.2);
        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    wireframe: true,
    transparent: true,
  });

  const outerMesh = new THREE.Mesh(outerGeo, outerMat);
  anomalyGroup.add(outerMesh);

  // Glow sphere (backside additive)
  const glowGeo = new THREE.SphereGeometry(radius * 1.2, GLOW_SEGMENTS, GLOW_SEGMENTS);
  const glowMat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      color: { value: new THREE.Color(0x00f0ff) },
      audioLevel: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;
      uniform float audioLevel;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = position * (1.0 + audioLevel * 0.2);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(vPosition, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;
      uniform vec3 color;
      uniform float time;
      uniform float audioLevel;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vPosition);
        float fresnel = 1.0 - max(0.0, dot(viewDir, vNormal));
        fresnel = pow(fresnel, 3.0 + audioLevel * 3.0);
        float pulse = 0.5 + 0.5 * sin(time * 2.0);
        float af = 1.0 + audioLevel * 3.0;

        vec3 cyan = vec3(0.0, 0.94, 1.0);
        vec3 magenta = vec3(1.0, 0.0, 0.67);
        vec3 glowColor = mix(cyan, magenta, 0.3 + audioLevel * 0.4);

        vec3 finalColor = glowColor * fresnel * (0.8 + 0.2 * pulse) * af;
        float alpha = fresnel * (0.3 * af) * (1.0 - audioLevel * 0.2);
        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
    transparent: true,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  anomalyGroup.add(new THREE.Mesh(glowGeo, glowMat));
  scene.add(anomalyGroup);

  return function update(time, audioLevel) {
    outerMat.uniforms.time.value = time;
    outerMat.uniforms.audioLevel.value = audioLevel;
    glowMat.uniforms.time.value = time;
    glowMat.uniforms.audioLevel.value = audioLevel;
  };
}

// ─── BACKGROUND PARTICLES ────────────────────────────────

function createBackgroundParticles() {
  const count = PARTICLE_COUNT;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  const c1 = new THREE.Color(0x00f0ff); // cyan
  const c2 = new THREE.Color(0xff00aa); // magenta
  const c3 = new THREE.Color(0xb44aff); // purple

  for (let i = 0; i < count; i++) {
    positions[i * 3]     = (Math.random() - 0.5) * 80;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 80;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 80;

    const pick = Math.random();
    const c = pick < 0.4 ? c1 : pick < 0.7 ? c2 : c3;
    colors[i * 3]     = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;

    sizes[i] = 0.04 + Math.random() * 0.03;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      attribute float size;
      varying vec3 vColor;
      uniform float time;
      void main() {
        vColor = color;
        vec3 pos = position;
        pos.x += sin(time * 0.1 + position.z * 0.2) * 0.05;
        pos.y += cos(time * 0.1 + position.x * 0.2) * 0.05;
        pos.z += sin(time * 0.1 + position.y * 0.2) * 0.05;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = size * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float r = distance(gl_PointCoord, vec2(0.5));
        if (r > 0.5) discard;
        float glow = pow(1.0 - r * 2.0, 2.0);
        gl_FragColor = vec4(vColor, glow);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });

  scene.add(new THREE.Points(geo, mat));

  return function update(time) {
    mat.uniforms.time.value = time;
  };
}

// ─── CIRCULAR 2D OVERLAY ─────────────────────────────────

function initCircularOverlay() {
  circularCanvas = document.createElement('canvas');
  circularCanvas.style.position = 'absolute';
  circularCanvas.style.inset = '0';
  circularCanvas.style.pointerEvents = 'none';
  circularCanvas.style.zIndex = '2';
  circularCanvas.width = container.clientWidth;
  circularCanvas.height = container.clientHeight;
  container.appendChild(circularCanvas);
  circularCtx = circularCanvas.getContext('2d');
}

function drawCircularVisualizer(freqData) {
  if (!circularCtx || !circularCanvas) return;

  const w = circularCanvas.width;
  const h = circularCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  circularCtx.clearRect(0, 0, w, h);

  const numPoints = 128;
  const baseRadius = Math.min(w, h) * 0.22;
  const binCount = freqData.length;

  // Soft glow base
  circularCtx.beginPath();
  circularCtx.arc(cx, cy, baseRadius * 1.1, 0, Math.PI * 2);
  circularCtx.fillStyle = 'rgba(0, 240, 255, 0.03)';
  circularCtx.fill();

  // 3 concentric rings reacting to different frequency bands
  const rings = [
    { radiusMul: 0.7, color1: [0, 240, 255], color2: [0, 180, 220] },   // cyan — lows
    { radiusMul: 0.85, color1: [180, 74, 255], color2: [140, 50, 200] }, // purple — mids
    { radiusMul: 1.0, color1: [255, 0, 170], color2: [200, 0, 130] },    // magenta — highs
  ];

  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    const ringRadius = baseRadius * ring.radiusMul;
    const opacity = 0.7 - r * 0.15;

    const freqStart = Math.floor((r * binCount) / (rings.length * 1.5));
    const freqEnd = Math.floor(((r + 1) * binCount) / (rings.length * 1.5));
    const freqRange = freqEnd - freqStart;

    circularCtx.beginPath();
    for (let i = 0; i < numPoints; i++) {
      const segSize = Math.max(1, Math.floor(freqRange / numPoints));
      let sum = 0;
      for (let j = 0; j < segSize; j++) {
        sum += freqData[freqStart + ((i * segSize + j) % freqRange)];
      }
      const value = sum / (segSize * 255);
      const dynRadius = ringRadius * (1 + value * 0.6);
      const angle = (i / numPoints) * Math.PI * 2;
      const x = cx + Math.cos(angle) * dynRadius;
      const y = cy + Math.sin(angle) * dynRadius;
      if (i === 0) circularCtx.moveTo(x, y);
      else circularCtx.lineTo(x, y);
    }
    circularCtx.closePath();

    const grad = circularCtx.createRadialGradient(cx, cy, ringRadius * 0.8, cx, cy, ringRadius * 1.2);
    const [r1, g1, b1] = ring.color1;
    const [r2, g2, b2] = ring.color2;
    grad.addColorStop(0, `rgba(${r1},${g1},${b1},${opacity})`);
    grad.addColorStop(1, `rgba(${r2},${g2},${b2},${opacity * 0.6})`);

    circularCtx.strokeStyle = grad;
    circularCtx.lineWidth = 2 + (rings.length - r);
    circularCtx.stroke();
  }
}

// ─── ANIMATION LOOP ──────────────────────────────────────

function animate() {
  animationId = requestAnimationFrame(animate);

  if (!renderer || !scene || !camera) return;

  controls.update();
  const time = clock.getElapsedTime();

  // Get audio level from our analyser
  let audioLevel = 0;
  const analyser = getAnalyser();
  if (analyser) {
    if (!frequencyData || frequencyData.length !== analyser.frequencyBinCount) {
      frequencyData = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(frequencyData);

    let sum = 0;
    for (let i = 0; i < frequencyData.length; i++) sum += frequencyData[i];
    audioLevel = Math.min(1.0, (sum / frequencyData.length / 255) * 1.8);

    drawCircularVisualizer(frequencyData);
  }

  // Update anomaly
  if (updateGlow) updateGlow(time, audioLevel);
  if (updateParticles) updateParticles(time);

  // Rotate anomaly
  if (anomalyGroup) {
    const rotFactor = 1 + audioLevel * 1.5;
    anomalyGroup.rotation.y += 0.004 * rotFactor;
    anomalyGroup.rotation.z += 0.002 * rotFactor;
  }

  renderer.render(scene, camera);
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('char3d');
const fallbackVideo = document.getElementById('bgvid');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const api = {
  ready: false,
  state: 'idle',
  audioLevel: 0,
  facing: 0,
  stateChangedAt: performance.now(),
  setState(state = 'idle') {
    const next = ['idle', 'listening', 'thinking', 'speaking'].includes(state) ? state : 'idle';
    if (next !== this.state) this.stateChangedAt = performance.now();
    this.state = next;
  },
  setAudioLevel(level = 0) {
    this.audioLevel = THREE.MathUtils.clamp(Number(level) || 0, 0, 0.35);
  },
  setFacing(radians = 0) {
    this.facing = Number.isFinite(Number(radians)) ? Number(radians) : 0;
  }
};
window.xiaoci3d = api;

if (!canvas || !window.WebGL2RenderingContext) {
  document.body.classList.add('three-fallback');
} else {
  try {
    initialise3D();
  } catch (error) {
    useFallback(error);
  }
}

function initialise3D() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(0, 0.05, 7.35);
  camera.lookAt(0, 0.05, 0);

  scene.add(new THREE.HemisphereLight(0xf7f4ff, 0x776a9f, 1.65));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(-3.5, 5, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8fdcff, 0.9);
  fill.position.set(4, 1.5, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffa9d5, 0.65);
  rim.position.set(0, 3, -4);
  scene.add(rim);

  const clock = new THREE.Clock();
  const characterRoot = new THREE.Group();
  scene.add(characterRoot);

  let mixer = null;
  let head = null;
  let mouth = null;
  let mouthOpening = null;
  let mouthTongue = null;
  let modelLoaded = false;
  let smoothedVoice = 0;
  const stablePose = new Map();
  const bones = {};
  const additive = new THREE.Quaternion();
  const euler = new THREE.Euler();

  new GLTFLoader().load(
    'models/xiaoci-rigged-v2.glb',
    (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      model.position.set(-centre.x, -centre.y, -centre.z);
      characterRoot.scale.setScalar(3.0 / Math.max(size.y, 0.001));
      characterRoot.add(model);

      model.traverse((object) => {
        if (object.isMesh) {
          object.frustumCulled = false;
          object.geometry.computeVertexNormals();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            material.side = THREE.DoubleSide;
            material.flatShading = false;
            if ('roughness' in material) material.roughness = 0.82;
            if ('metalness' in material) material.metalness = 0;
            material.needsUpdate = true;
          }
        }
      });

      head = model.getObjectByName('Head');
      for (const name of [
        'Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head',
        'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
        'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'
      ]) bones[name] = model.getObjectByName(name);

      if (gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        const standingPose = mixer.clipAction(gltf.animations[0]);
        standingPose.play();
        mixer.setTime(Math.min(0.2, gltf.animations[0].duration));
        mixer.update(0);
        standingPose.paused = true;
      }

      // Capture one calm frame from the supplied clip. Every rendered frame starts
      // from this pose, so procedural motion never accumulates or drifts.
      model.traverse((object) => {
        if (!object.isBone) return;
        stablePose.set(object, {
          position: object.position.clone(),
          quaternion: object.quaternion.clone(),
          scale: object.scale.clone()
        });
      });

      ({ group: mouth, opening: mouthOpening, tongue: mouthTongue } = createMouth());
      if (head) head.add(mouth);

      modelLoaded = true;
      api.ready = true;
      document.body.classList.remove('three-fallback');
      document.body.classList.add('three-ready');
      fallbackVideo?.pause();
      window.dispatchEvent(new CustomEvent('xiaoci3dready'));
    },
    undefined,
    useFallback
  );

  function resize() {
    const width = Math.max(innerWidth, 1);
    const height = Math.max(innerHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render() {
    requestAnimationFrame(render);
    if (document.hidden) {
      clock.getDelta();
      return;
    }

    const delta = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;
    if (mixer) mixer.update(0);

    if (modelLoaded) {
      restoreStablePose();
      applyUprightPosture();
      animateNaturalStance(elapsed);

      const voiceTarget = THREE.MathUtils.clamp(api.audioLevel * 9, 0, 1);
      const voiceEase = 1 - Math.exp(-delta * (voiceTarget > smoothedVoice ? 22 : 13));
      smoothedVoice = THREE.MathUtils.lerp(smoothedVoice, voiceTarget, voiceEase);
      animateMouth(elapsed, smoothedVoice);

      if (!reducedMotion && api.state === 'speaking') {
        const speakingFor = Math.max(0, performance.now() - api.stateChangedAt) / 1000;
        animateExplanationGestures(speakingFor);
      }
    }

    renderer.render(scene, camera);
  }

  function restoreStablePose() {
    for (const [bone, pose] of stablePose) {
      bone.position.copy(pose.position);
      bone.quaternion.copy(pose.quaternion);
      bone.scale.copy(pose.scale);
    }
  }

  function applyAdditive(bone, x, y, z, amount = 1) {
    if (!bone) return;
    euler.set(x * amount, y * amount, z * amount, 'XYZ');
    additive.setFromEuler(euler);
    bone.quaternion.multiply(additive);
  }

  function applyUprightPosture() {
    // Bring the chest and head back over the hips without forcing a rigid pose.
    applyAdditive(bones.Spine02, -0.065, 0, 0);
    applyAdditive(bones.Spine01, -0.025, 0, 0);
    applyAdditive(bones.Spine, -0.018, 0, 0);
    applyAdditive(bones.neck, -0.035, 0, 0);
    applyAdditive(bones.Head, -0.025, 0, 0);
  }

  function animateNaturalStance(elapsed) {
    const motion = reducedMotion ? 0 : api.state === 'idle' ? 1 : api.state === 'speaking' ? 0.18 : 0.45;
    const weightShift = Math.sin(elapsed * 0.68);
    const breath = Math.sin(elapsed * 1.18 + 0.7);

    // Millimetre-scale motion keeps the character alive without looking wobbly.
    characterRoot.position.set(weightShift * 0.004 * motion, breath * 0.0025 * motion, 0);
    characterRoot.rotation.set(
      0,
      api.facing + weightShift * 0.005 * motion,
      Math.sin(elapsed * 0.52 + 1.2) * 0.0035 * motion
    );
    applyAdditive(bones.Spine02, breath * 0.0035, 0, weightShift * 0.0045, motion);
    applyAdditive(bones.neck, -breath * 0.0015, -weightShift * 0.002, 0, motion);
  }

  function createMouth() {
    const group = new THREE.Group();
    group.name = 'XiaociSpeakingMouth';
    group.position.set(0.2, 21.0, 21.8);
    group.visible = false;

    // The generated GLB has a smile baked into its texture. A feathered skin
    // patch hides that smile only while speech animation is active, preventing
    // the original and animated mouths from appearing at the same time.
    const coverCanvas = document.createElement('canvas');
    coverCanvas.width = 128;
    coverCanvas.height = 64;
    const coverContext = coverCanvas.getContext('2d');
    const coverPixels = coverContext.createImageData(128, 64);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 128; x += 1) {
        const dx = (x - 63.5) / 63.5;
        const dy = (y - 31.5) / 31.5;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const feather = 1 - smoothstep((distance - 0.72) / 0.28);
        const vertical = y / 63;
        const rightShade = Math.max(0, dx) * 3;
        const offset = (y * 128 + x) * 4;
        coverPixels.data[offset] = Math.round(242 - vertical * 5 - rightShade);
        coverPixels.data[offset + 1] = Math.round(214 - vertical * 10 - rightShade);
        coverPixels.data[offset + 2] = Math.round(190 - vertical * 12 - rightShade * 0.7);
        coverPixels.data[offset + 3] = Math.round(feather * 255);
      }
    }
    coverContext.putImageData(coverPixels, 0, 0);
    const coverTexture = new THREE.CanvasTexture(coverCanvas);
    coverTexture.colorSpace = THREE.SRGBColorSpace;
    const cover = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: coverTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false
      })
    );
    cover.scale.set(20, 7, 1);
    cover.position.z = -0.02;
    cover.renderOrder = 19;
    group.add(cover);

    const opening = new THREE.Mesh(
      new THREE.CircleGeometry(1, 32),
      new THREE.MeshBasicMaterial({
        color: 0x70223f,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false
      })
    );
    opening.scale.set(6.2, 1.0, 1);
    opening.renderOrder = 20;
    group.add(opening);

    const tongue = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff7899,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false
      })
    );
    tongue.position.set(0, -0.5, 0.04);
    tongue.scale.set(4.0, 0.55, 1);
    tongue.renderOrder = 21;
    group.add(tongue);
    return { group, opening, tongue };
  }

  function animateMouth(elapsed, voice) {
    if (!mouth || !mouthOpening || !mouthTongue) return;
    const speaking = api.state === 'speaking';
    mouth.visible = speaking;
    if (!speaking) return;

    // Audio controls the opening while a low-amplitude syllable pulse avoids a
    // frozen mouth between streamed audio chunks.
    const syllable = 0.58 + Math.sin(elapsed * 16.4) * 0.24 + Math.sin(elapsed * 23.1) * 0.18;
    const openness = THREE.MathUtils.clamp(0.08 + voice * syllable, 0.08, 1);
    mouthOpening.scale.y = 0.55 + openness * 3.1;
    mouthOpening.scale.x = 6.2 - openness * 0.6;
    mouthTongue.position.y = -0.25 - openness * 0.9;
    mouthTongue.scale.y = 0.28 + openness * 0.5;
  }

  function animateExplanationGestures(time) {
    // Each six-second phrase contains a clear setup, emphasis and return. Arms
    // alternate so the character explains instead of continuously waving.
    const phase = time % 6;
    const right = gestureWindow(phase, 0.35, 1.1, 2.05, 2.75);
    const left = gestureWindow(phase, 3.15, 3.85, 5.05, 5.75);
    const emphasis = Math.sin(Math.min(1, Math.max(0, phase - 0.7)) * Math.PI * 2) * 0.035;

    applyAdditive(bones.RightShoulder, -0.12, -0.04, -0.16, right);
    applyAdditive(bones.RightArm, -0.55, -0.20, -0.86, right);
    applyAdditive(bones.RightForeArm, -0.78, 0.10, -0.45, right);
    applyAdditive(bones.RightHand, 0.10, 0.18, -0.25 + emphasis, right);

    applyAdditive(bones.LeftShoulder, -0.10, 0.04, 0.15, left);
    applyAdditive(bones.LeftArm, -0.52, 0.20, 0.82, left);
    applyAdditive(bones.LeftForeArm, -0.75, -0.10, 0.42, left);
    applyAdditive(bones.LeftHand, 0.10, -0.18, 0.24 - emphasis, left);
  }

  function gestureWindow(time, enter, holdStart, holdEnd, exit) {
    if (time <= enter || time >= exit) return 0;
    if (time < holdStart) return smoothstep((time - enter) / (holdStart - enter));
    if (time <= holdEnd) return 1;
    return 1 - smoothstep((time - holdEnd) / (exit - holdEnd));
  }

  function smoothstep(value) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  addEventListener('resize', resize, { passive: true });
  resize();
  render();
}

function useFallback(error) {
  console.warn('3D character unavailable; using the MP4 fallback.', error);
  api.ready = false;
  document.body.classList.remove('three-ready');
  document.body.classList.add('three-fallback');
}

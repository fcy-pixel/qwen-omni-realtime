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
  setState(state = 'idle') {
    this.state = ['idle', 'listening', 'thinking', 'speaking'].includes(state) ? state : 'idle';
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
  let neck = null;
  let spine = null;
  let modelLoaded = false;
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
      neck = model.getObjectByName('neck');
      spine = model.getObjectByName('Spine02') || model.getObjectByName('Spine');

      if (gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(gltf.animations[0]).setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.35).play();
      }

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
    if (mixer) mixer.update(delta);

    if (modelLoaded && !reducedMotion) {
      const voice = THREE.MathUtils.clamp(api.audioLevel * 8, 0, 1);
      let headPitch = 0;
      let headYaw = Math.sin(elapsed * 0.48) * 0.025;
      let headRoll = Math.sin(elapsed * 0.37) * 0.018;
      let bodyPitch = 0;
      let bodyYaw = Math.sin(elapsed * 0.32) * 0.018;
      let bob = Math.sin(elapsed * 1.05) * 0.012;

      if (api.state === 'listening') {
        headPitch = 0.035 + Math.sin(elapsed * 0.7) * 0.018;
        headRoll += 0.045;
        bodyPitch = 0.018;
      } else if (api.state === 'thinking') {
        headYaw += Math.sin(elapsed * 0.82) * 0.06;
        headRoll += 0.085;
        headPitch = -0.035;
        bodyYaw += Math.sin(elapsed * 0.55) * 0.028;
      } else if (api.state === 'speaking') {
        headPitch = Math.sin(elapsed * 4.8) * (0.018 + voice * 0.045);
        headYaw += Math.sin(elapsed * 1.8) * (0.025 + voice * 0.025);
        bodyYaw += Math.sin(elapsed * 1.25) * 0.035;
        bob += voice * 0.025;
      }

      characterRoot.position.y = bob;
      characterRoot.rotation.y = api.facing + bodyYaw;
      applyAdditive(spine, bodyPitch, bodyYaw * 0.35, 0);
      applyAdditive(neck, headPitch * 0.35, headYaw * 0.35, headRoll * 0.35);
      applyAdditive(head, headPitch, headYaw, headRoll);
    }

    renderer.render(scene, camera);
  }

  function applyAdditive(bone, x, y, z) {
    if (!bone) return;
    euler.set(x, y, z, 'XYZ');
    additive.setFromEuler(euler);
    bone.quaternion.multiply(additive);
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

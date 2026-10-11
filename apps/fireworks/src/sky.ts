import {
  AdditiveBlending,
  CanvasTexture,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import {
  ApplyForce,
  BatchedRenderer,
  ColorOverLife,
  ConstantColor,
  ConstantValue,
  Gradient,
  IntervalValue,
  ParticleSystem,
  RenderMode,
  SphereEmitter,
  Vector3,
  Vector4,
} from 'three.quarks';

const WIDTH = 16;
const HEIGHT = 9;

export interface Sky {
  /** The one system every shell emits into. */
  system: ParticleSystem;
  /** Ages the sparks by `seconds` and draws them. */
  render(seconds: number): void;
  /** A pointer position as a place in the sky. */
  toWorld(clientX: number, clientY: number): { x: number; y: number };
}

function glow(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  const fill = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  fill.addColorStop(0, 'rgba(255, 255, 255, 1)');
  fill.addColorStop(0.35, 'rgba(255, 255, 255, 0.5)');
  fill.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = fill;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

export function createSky(canvas: HTMLCanvasElement): Sky {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new Scene();
  const camera = new OrthographicCamera(-WIDTH / 2, WIDTH / 2, HEIGHT, 0, 0.1, 20);
  camera.position.z = 10;

  const system = new ParticleSystem({
    looping: true,
    duration: 1,
    worldSpace: true,
    shape: new SphereEmitter({ radius: 0.02, thickness: 1 }),
    startLife: new IntervalValue(1.1, 1.8),
    startSpeed: new IntervalValue(2.6, 4.4),
    startSize: new IntervalValue(0.16, 0.26),
    startColor: new ConstantColor(new Vector4(1, 1, 1, 1)),
    emissionOverTime: new ConstantValue(0),
    renderMode: RenderMode.BillBoard,
    material: new MeshBasicMaterial({
      map: glow(),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
    behaviors: [
      new ApplyForce(new Vector3(0, -1, 0), new ConstantValue(1.6)),
      new ColorOverLife(
        new Gradient(
          [
            [new Vector3(1, 1, 1), 0],
            [new Vector3(1, 1, 1), 1],
          ],
          [
            [1, 0],
            [1, 0.5],
            [0, 1],
          ],
        ),
      ),
    ],
  });
  const batch = new BatchedRenderer();
  batch.addSystem(system);
  scene.add(system.emitter, batch);

  const fit = () => renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  new ResizeObserver(fit).observe(canvas);
  fit();

  return {
    system,
    render(seconds) {
      batch.update(seconds);
      renderer.render(scene, camera);
    },
    toWorld(clientX, clientY) {
      const box = canvas.getBoundingClientRect();
      return {
        x: ((clientX - box.left) / box.width - 0.5) * WIDTH,
        y: (1 - (clientY - box.top) / box.height) * HEIGHT,
      };
    },
  };
}

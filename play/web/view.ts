// One WebGL viewer for every 3D screen: models resolve through the install, textures swap
// .blp for .dds, team colors are Reforged's. Screens add instances and call fit().

import { quat } from "gl-matrix";
import { setFetch } from "../vendor/mdx-m3-viewer/common/fetchdatatype";
import handlers from "../vendor/mdx-m3-viewer/viewer/handlers";
import type MdxModel from "../vendor/mdx-m3-viewer/viewer/handlers/mdx/model";
import type MdxModelInstance from "../vendor/mdx-m3-viewer/viewer/handlers/mdx/modelinstance";
import ModelViewer from "../vendor/mdx-m3-viewer/viewer/viewer";
import type { Wc3 } from "./wc3";

const standSequence = (model: MdxModel) => Math.max(0, model.sequences.findIndex((s) => /^stand(\s|$)/i.test(s.name)));

export class View {
  readonly viewer: ModelViewer;
  readonly scene;
  private running = false;
  private solver: (src: unknown) => unknown;

  constructor(wc3: Wc3, readonly canvas: HTMLCanvasElement) {
    setFetch(async (path) => {
      try {
        return new Response(await wc3.casc.read(path));
      } catch (e) {
        return new Response(String(e), { status: 404 });
      }
    });
    this.viewer = new ModelViewer(canvas, { alpha: false, antialias: true });
    this.viewer.on("error", (e) => console.error(e));
    this.solver = (src: unknown) => (typeof src === "string" ? wc3.resolve(src) : src);
    this.viewer.addHandler(handlers.mdx, this.solver, true);
    this.viewer.addHandler(handlers.blp);
    this.viewer.addHandler(handlers.dds);
    this.viewer.addHandler(handlers.tga);
    this.scene = this.viewer.addScene();
    addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const { canvas, scene } = this;
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    scene.viewport[2] = canvas.width;
    scene.viewport[3] = canvas.height;
    scene.camera.perspective(Math.PI / 5, canvas.width / canvas.height, 10, 20000);
  }

  model(path: string): Promise<MdxModel | undefined> {
    return this.viewer.load(path, this.solver) as Promise<MdxModel | undefined>;
  }

  /** Adds an instance playing its first "Stand" sequence, facing the camera on -Y. */
  stand(model: MdxModel, team = 0): MdxModelInstance {
    const instance = model.addInstance() as MdxModelInstance;
    instance.setScene(this.scene);
    instance.setSequence(standSequence(model));
    instance.setSequenceLoopMode(2);
    instance.setTeamColor(team);
    instance.setRotation(quat.setAxisAngle(quat.create(), [0, 0, 1], -Math.PI / 2));
    return instance;
  }

  /** Frames a standing instance from the front, slightly above, using the Stand sequence's own bounds. */
  fit(model: MdxModel): void {
    const { x, y, z, r } = model.sequences[standSequence(model)].bounds;
    const [cx, cy] = [y, -x]; // the instance is turned -90° about Z by stand()
    const distance = (r * 1.1) / Math.sin(Math.PI / 10);
    this.scene.camera.moveToAndFace([cx, cy - distance, z + distance * 0.2], [cx, cy, z], [0, 0, 1]);
  }

  clear(): void {
    this.scene.clear();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resize();
    const step = () => {
      if (!this.running) return;
      requestAnimationFrame(step);
      this.viewer.updateAndRender();
    };
    step();
  }

  stop(): void {
    this.running = false;
  }
}

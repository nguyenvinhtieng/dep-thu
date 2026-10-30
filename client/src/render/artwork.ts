import Phaser from 'phaser';
import { dodging, SlipperState, WORLD } from '@dep/shared';
import type { RenderPlayer, RenderSlipper } from '../net/match';

const CAST = 'alley-cast-v2';
const PROPS = 'alley-props-v2';
const RUN = 'alley-run-v2';
const ACTION = 'alley-action-v2';
const CHARACTERS = Array.from({ length: 5 }, (_, i) => `character-${i}`);
const PROP_NAMES = ['roof', 'chairs', 'foam', 'flowers', 'lantern', 'sign'];

/** Trim each equal atlas cell to its alpha bounds, keeping feet anchors predictable. */
function frames(scene: Phaser.Scene, key: string, names: string[], regions?: number[][]) {
  if (!scene.textures.exists(key)) return;
  const texture = scene.textures.get(key);
  const source = texture.getSourceImage() as HTMLImageElement;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const cw = Math.floor(canvas.width / 3), ch = Math.floor(canvas.height / 2);
  names.forEach((name, i) => {
    const [ox, oy, width, height] = regions?.[i] ?? [i % 3 * cw, Math.floor(i / 3) * ch, cw, ch];
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (pixels[((oy + y) * canvas.width + ox + x) * 4 + 3] < 32) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right >= left && bottom >= top && !texture.has(name)) {
      texture.add(name, 0, ox + left, oy + top, right - left + 1, bottom - top + 1);
    }
  });
}

/** Reuse images every frame; visual transforms never change simulation coordinates. */
export class Artwork {
  private players = new Map<number, Phaser.GameObjects.Image>();
  private slippers = new Map<number, Phaser.GameObjects.Image>();
  private icons: Phaser.GameObjects.Image[] = [];
  private iconIndex = 0;
  private throws = new Map<number, number>();
  private seenSlippers = new Set<number>();

  static preload(scene: Phaser.Scene) {
    const base = import.meta.env.BASE_URL;
    scene.load.image(CAST, `${base}art/alley-cast-v2.png`);
    scene.load.image(PROPS, `${base}art/alley-props-v2.png`);
    scene.load.image(RUN, `${base}art/alley-run-v2.png`);
    scene.load.image(ACTION, `${base}art/alley-action-v2.png`);
  }

  constructor(private scene: Phaser.Scene) {
    frames(scene, CAST, [...CHARACTERS, 'slipper']);
    frames(scene, RUN, CHARACTERS);
    frames(scene, ACTION, CHARACTERS);
    // Generated art can extend beyond equal cells: isolate actual object regions.
    frames(scene, PROPS, PROP_NAMES, [
      [20, 120, 535, 392], [570, 24, 435, 490], [1024, 220, 512, 295],
      [70, 514, 410, 510], [640, 548, 260, 450], [1024, 640, 500, 300],
    ]);
  }

  private has(key: string, names: string[]) {
    return this.scene.textures.exists(key) && names.every(name => this.scene.textures.get(key).has(name));
  }
  get ready() { return this.has(CAST, [...CHARACTERS, 'slipper']); }
  get propsReady() { return this.has(PROPS, PROP_NAMES); }

  environment() {
    for (const p of WORLD.platforms) {
      // Alpha-trimmed top edges coincide exactly with the physical platform surface.
      this.scene.add.image(p.x, p.y, PROPS, p.kind).setOrigin(0)
        .setDisplaySize(p.w, WORLD.floorY - p.y).setDepth(0);
    }
    for (const [x, flip] of [[36, false], [1244, true]] as const) {
      this.scene.add.image(x, WORLD.floorY + 4, PROPS, 'flowers').setOrigin(0.5, 1)
        .setDisplaySize(105, 186).setFlipX(flip).setDepth(1);
    }
    for (const [x, y] of [[110, 230], [1170, 220]]) {
      const lantern = this.scene.add.image(x, y, PROPS, 'lantern').setOrigin(0.5, 0).setDisplaySize(29, 55);
      this.scene.tweens.add({ targets: lantern, angle: 5, duration: 2100 + x, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    this.scene.add.image(640, 440, PROPS, 'sign').setDisplaySize(145, 35);
    this.scene.add.image(1010, 605, PROPS, 'sign').setDisplaySize(125, 30);
  }

  begin() {
    for (const image of this.players.values()) image.setVisible(false);
    for (const image of this.icons) image.setVisible(false);
    this.iconIndex = 0;
    this.seenSlippers.clear();
  }

  player(p: RenderPlayer, character: number, now: number) {
    if (!p.active) return;
    let image = this.players.get(p.slot);
    if (!image) {
      image = this.scene.add.image(0, 0, CAST, `character-${character}`).setOrigin(0.5, 1).setDepth(3);
      this.players.set(p.slot, image);
    }
    const running = p.onGround && Math.abs(p.vx) > 40;
    const step = running ? Math.sin(now / 65) : Math.sin(now / 350) * 0.18;
    const crouching = p.pickLock > 0;
    const rolling = p.alive && dodging(p);
    const windup = p.charge >= 0;
    const reaching = p.catchWin > 0;
    const throwing = now < (this.throws.get(p.slot) ?? 0);
    const action = p.alive && !rolling && !crouching && p.stun <= 0 && (reaching || throwing);
    const runFrame = p.alive && !rolling && !crouching && !action && p.stun <= 0 &&
      ((!p.onGround) || (running && Math.floor(now / 100) % 2 === 0));
    const key = action && this.has(ACTION, CHARACTERS) ? ACTION :
      runFrame && this.has(RUN, CHARACTERS) ? RUN : CAST;
    image.setTexture(key, `character-${character}`).setVisible(true).setFlipX(p.facing < 0);
    const height = character === 2 ? 81 : 94;
    const scale = height / image.frame.height;
    const sx = crouching ? 1.13 : !p.onGround ? 0.93 : 1 + Math.abs(step) * 0.025;
    const sy = crouching ? 0.74 : !p.onGround ? 1.06 : 1 - Math.abs(step) * 0.025;
    image.setScale(scale * sx, scale * sy).setPosition(p.x, p.y - (running ? Math.abs(step) * 3 : step));
    image.setAngle(!p.alive ? p.facing * 85 : rolling ? now / 2.2 * p.facing :
      (windup ? -12 : reaching || throwing ? 13 : running ? 7 + step * 3 : !p.onGround ? -6 : step) * p.facing);
    image.setAlpha(!p.connected ? 0.45 : p.invuln > 0 && Math.floor(now / 80) % 2 === 0 ? 0.35 : 1);
    image.clearTint();
    if (p.stun > 0) image.setTint(0xffc4a0);
    if (rolling) image.setOrigin(0.5, 0.5).setPosition(p.x, p.y - 27).setScale(scale * 0.68);
    else if (!p.alive) image.setOrigin(0.5, 0.78).setPosition(p.x, p.y - 21).setTint(0xc7b4a1);
    else image.setOrigin(0.5, 1);
    if (p.alive && !rolling && !throwing && p.ammo > 0) {
      this.icon(p.x + p.facing * (windup ? -26 : reaching ? 36 : 23),
        p.y - (windup ? 66 : crouching ? 22 : 43), 23, windup ? -p.facing * 1.1 : p.facing * 0.3, 3.5);
    }
  }

  throw(slot: number) {
    this.throws.set(slot, performance.now() + 180);
  }

  slipper(s: RenderSlipper, id: number) {
    if (s.state === SlipperState.Held) return;
    this.seenSlippers.add(id);
    let image = this.slippers.get(id);
    if (!image) {
      image = this.scene.add.image(0, 0, CAST, 'slipper').setDepth(2);
      this.slippers.set(id, image);
    }
    image.setPosition(s.x, s.y).setRotation(s.angle / 256 * Math.PI * 2)
      .setDisplaySize(35, 17).setAlpha(s.ghost ? 0.7 : 1);
  }

  icon(x: number, y: number, width = 25, angle = -0.35, depth = 12) {
    let image = this.icons[this.iconIndex];
    if (!image) {
      image = this.scene.add.image(0, 0, CAST, 'slipper');
      this.icons.push(image);
    }
    this.iconIndex++;
    image.setPosition(x, y).setDisplaySize(width, width * 0.48).setRotation(angle).setDepth(depth).setVisible(true);
  }

  end() {
    for (const [id, image] of this.slippers) if (!this.seenSlippers.has(id)) {
      image.destroy();
      this.slippers.delete(id);
    }
  }
}

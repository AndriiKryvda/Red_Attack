import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Procedural texture library.
//
// Generates PBR-friendly material maps (albedo + normal + optional roughness)
// entirely at runtime on a 2D canvas, so the game needs no external image
// assets. Each material is built once and cached. Color maps are tagged as
// sRGB; normal/roughness maps stay linear.
// ─────────────────────────────────────────────────────────────────────────────

export interface MaterialMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap?: THREE.Texture;
}

const ANISOTROPY = 4;
const SIZE = 512;

// Deterministic PRNG so textures look identical every run.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function rgba(hex: number, a: number): string {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return `rgba(${r},${g},${b},${a})`;
}

// Soft cloud-like noise made from many overlapping radial gradients.
function blobs(
  ctx: CanvasRenderingContext2D,
  size: number,
  rand: () => number,
  palette: number[],
  count: number,
  minR: number,
  maxR: number,
  alpha: number
): void {
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (minR + rand() * (maxR - minR));
    const col = palette[(rand() * palette.length) | 0];
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(col, alpha));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Convert a grayscale height canvas into a tangent-space normal map (Sobel).
function heightToNormal(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const size = height.width;
  const src = height.getContext('2d')!.getImageData(0, 0, size, size).data;
  const [out, octx] = makeCanvas(size);
  const dst = octx.createImageData(size, size);

  const lum = (x: number, y: number): number => {
    x = (x + size) % size;
    y = (y + size) % size;
    const i = (y * size + x) * 4;
    return (src[i] + src[i + 1] + src[i + 2]) / 765;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (lum(x - 1, y) - lum(x + 1, y)) * strength;
      const dy = (lum(x, y - 1) - lum(x, y + 1)) * strength;
      const nz = 1;
      const len = Math.hypot(dx, dy, nz) || 1;
      const nx = dx / len;
      const ny = dy / len;
      const i = (y * size + x) * 4;
      dst.data[i] = ((nx * 0.5 + 0.5) * 255) | 0;
      dst.data[i + 1] = ((ny * 0.5 + 0.5) * 255) | 0;
      dst.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      dst.data[i + 3] = 255;
    }
  }
  octx.putImageData(dst, 0, 0);
  return out;
}

function toTexture(canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = ANISOTROPY;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

type DrawFn = (ctx: CanvasRenderingContext2D, size: number, rand: () => number) => void;

// Build a full set of maps from a color draw fn + a height draw fn.
function build(
  colorDraw: DrawFn,
  heightDraw: DrawFn,
  normalStrength: number,
  roughnessDraw?: DrawFn
): MaterialMaps {
  const rand = mulberry32(0x1a2b3c);

  const [colorCanvas, colorCtx] = makeCanvas(SIZE);
  colorDraw(colorCtx, SIZE, rand);

  const [heightCanvas, heightCtx] = makeCanvas(SIZE);
  heightDraw(heightCtx, SIZE, mulberry32(0x77aa11));
  const normalCanvas = heightToNormal(heightCanvas, normalStrength);

  let roughnessMap: THREE.Texture | undefined;
  if (roughnessDraw) {
    const [roughCanvas, roughCtx] = makeCanvas(SIZE);
    roughnessDraw(roughCtx, SIZE, mulberry32(0x335577));
    roughnessMap = toTexture(roughCanvas, false);
  }

  return {
    map: toTexture(colorCanvas, true),
    normalMap: toTexture(normalCanvas, false),
    roughnessMap,
  };
}

// Clone a set of maps and set tiling (so one base texture can tile differently
// per object without mutating the cached original).
export function tile(m: MaterialMaps, rx: number, ry: number): MaterialMaps {
  const clone = (t: THREE.Texture): THREE.Texture => {
    const c = t.clone();
    c.needsUpdate = true;
    c.repeat.set(rx, ry);
    return c;
  };
  return {
    map: clone(m.map),
    normalMap: clone(m.normalMap),
    roughnessMap: m.roughnessMap ? clone(m.roughnessMap) : undefined,
  };
}

// ── Individual material builders ───────────────────────────────────────────

function grassMaps(): MaterialMaps {
  return build(
    (ctx, s, rand) => {
      ctx.fillStyle = '#3f6b34';
      ctx.fillRect(0, 0, s, s);
      blobs(ctx, s, rand, [0x4a7c3f, 0x5a8c4f, 0x35592b, 0x6b9a5a, 0x2f4f24], 260, 0.02, 0.12, 0.5);
      for (let i = 0; i < 2600; i++) {
        const x = rand() * s;
        const y = rand() * s;
        const len = 4 + rand() * 10;
        const shade = 0x2a + ((rand() * 0x50) | 0);
        ctx.strokeStyle = `rgba(${(shade * 0.6) | 0},${shade + 40},${(shade * 0.5) | 0},0.5)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 4, y - len);
        ctx.stroke();
      }
    },
    (ctx, s, rand) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, s, s);
      blobs(ctx, s, rand, [0x9a9a9a, 0x666666, 0xb0b0b0, 0x555555], 220, 0.02, 0.1, 0.6);
      for (let i = 0; i < 1800; i++) {
        const x = rand() * s;
        const y = rand() * s;
        const len = 4 + rand() * 9;
        const v = 90 + ((rand() * 150) | 0);
        ctx.strokeStyle = `rgba(${v},${v},${v},0.5)`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 4, y - len);
        ctx.stroke();
      }
    },
    2.2
  );
}

function dirtMaps(): MaterialMaps {
  return build(
    (ctx, s, rand) => {
      ctx.fillStyle = '#6b5a3e';
      ctx.fillRect(0, 0, s, s);
      blobs(ctx, s, rand, [0x7a6a4a, 0x5a4a32, 0x8a7a55, 0x4a7c3f, 0x3f6b34], 240, 0.03, 0.14, 0.55);
    },
    (ctx, s, rand) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, s, s);
      blobs(ctx, s, rand, [0xa0a0a0, 0x606060, 0xc0c0c0, 0x4a4a4a], 200, 0.03, 0.12, 0.6);
    },
    2.6
  );
}

function barkMaps(): MaterialMaps {
  return build(
    (ctx, s, rand) => {
      ctx.fillStyle = '#5c3a1e';
      ctx.fillRect(0, 0, s, s);
      blobs(ctx, s, rand, [0x6b4423, 0x4a2f16, 0x7a5230, 0x3a2410], 120, 0.05, 0.18, 0.4);
      for (let i = 0; i < 260; i++) {
        const x = rand() * s;
        const dark = rand() > 0.5;
        ctx.strokeStyle = dark ? 'rgba(30,18,8,0.5)' : 'rgba(150,110,70,0.35)';
        ctx.lineWidth = 1 + rand() * 3;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        let y = 0;
        let cx = x;
        while (y < s) {
          cx += (rand() - 0.5) * 6;
          y += 12 + rand() * 18;
          ctx.lineTo(cx, y);
        }
        ctx.stroke();
      }
    },
    (ctx, s, rand) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) {
        const x = rand() * s;
        ctx.strokeStyle = rand() > 0.5 ? 'rgba(40,40,40,0.6)' : 'rgba(210,210,210,0.5)';
        ctx.lineWidth = 1 + rand() * 3;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        let y = 0;
        let cx = x;
        while (y < s) {
          cx += (rand() - 0.5) * 6;
          y += 12 + rand() * 18;
          ctx.lineTo(cx, y);
        }
        ctx.stroke();
      }
    },
    3.2
  );
}

function foliageMaps(): MaterialMaps {
  return build(
    (ctx, s, rand) => {
      ctx.fillStyle = '#2d5a27';
      ctx.fillRect(0, 0, s, s);
      blobs(ctx, s, rand, [0x3a6b2e, 0x234a1e, 0x4a7c3f, 0x1c3a16], 320, 0.02, 0.09, 0.55);
      for (let i = 0; i < 2200; i++) {
        const x = rand() * s;
        const y = rand() * s;
        const r = 1 + rand() * 2.5;
        const v = 0x2a + ((rand() * 0x50) | 0);
        ctx.fillStyle = `rgba(${(v * 0.5) | 0},${v + 30},${(v * 0.4) | 0},0.6)`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    (ctx, s, rand) => {
      ctx.fillStyle = '#707070';
      ctx.fillRect(0, 0, s, s);
      blobs(ctx, s, rand, [0x9a9a9a, 0x555555, 0xc0c0c0], 300, 0.02, 0.08, 0.6);
    },
    2.4
  );
}

function woodMaps(): MaterialMaps {
  return build(
    (ctx, s, rand) => {
      const rows = 4;
      const ph = s / rows;
      for (let r = 0; r < rows; r++) {
        const base = 0x6b4a2a + ((rand() * 0x20) | 0);
        ctx.fillStyle = `rgb(${(base >> 16) & 255},${(base >> 8) & 255},${base & 255})`;
        ctx.fillRect(0, r * ph, s, ph);
        for (let i = 0; i < 60; i++) {
          const y = r * ph + rand() * ph;
          ctx.strokeStyle = rand() > 0.5 ? 'rgba(60,38,18,0.35)' : 'rgba(150,110,70,0.25)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, y);
          let x = 0;
          let cy = y;
          while (x < s) {
            x += 16 + rand() * 24;
            cy += (rand() - 0.5) * 3;
            ctx.lineTo(x, cy);
          }
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(20,12,6,0.8)';
        ctx.fillRect(0, r * ph, s, 3);
      }
    },
    (ctx, s, rand) => {
      ctx.fillStyle = '#909090';
      ctx.fillRect(0, 0, s, s);
      const rows = 4;
      const ph = s / rows;
      for (let r = 0; r < rows; r++) {
        ctx.fillStyle = 'rgba(0,0,0,0.9)';
        ctx.fillRect(0, r * ph, s, 4);
        for (let i = 0; i < 50; i++) {
          const y = r * ph + rand() * ph;
          ctx.strokeStyle = rand() > 0.5 ? 'rgba(60,60,60,0.4)' : 'rgba(200,200,200,0.3)';
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(s, y + (rand() - 0.5) * 3);
          ctx.stroke();
        }
      }
    },
    2.0
  );
}

function roofMaps(): MaterialMaps {
  return build(
    (ctx, s, rand) => {
      ctx.fillStyle = '#5a2020';
      ctx.fillRect(0, 0, s, s);
      const rows = 8;
      const rh = s / rows;
      for (let r = 0; r < rows; r++) {
        const cols = 6;
        const cw = s / cols;
        const off = (r % 2) * (cw / 2);
        for (let c = -1; c <= cols; c++) {
          const x = c * cw + off;
          const y = r * rh;
          const shade = 0x7a + ((rand() * 0x30) | 0);
          ctx.fillStyle = `rgb(${shade},${(shade * 0.35) | 0},${(shade * 0.3) | 0})`;
          ctx.fillRect(x + 1, y + 1, cw - 2, rh - 1);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(x + 1, y + rh - 3, cw - 2, 3);
        }
      }
    },
    (ctx, s, rand) => {
      ctx.fillStyle = '#606060';
      ctx.fillRect(0, 0, s, s);
      const rows = 8;
      const rh = s / rows;
      for (let r = 0; r < rows; r++) {
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, r * rh, s, 4);
        const cols = 6;
        const cw = s / cols;
        const off = (r % 2) * (cw / 2);
        for (let c = -1; c <= cols; c++) {
          ctx.fillStyle = `rgba(${120 + ((rand() * 80) | 0)},120,120,0.5)`;
          ctx.fillRect(c * cw + off + 2, r * rh + 4, cw - 4, rh - 8);
        }
      }
    },
    2.8
  );
}

function metalMaps(): MaterialMaps {
  return build(
    (ctx, s, rand) => {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, '#9aa0a6');
      g.addColorStop(0.5, '#7d838a');
      g.addColorStop(1, '#6b7076');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 1400; i++) {
        const y = rand() * s;
        const v = 0x60 + ((rand() * 0x60) | 0);
        ctx.strokeStyle = `rgba(${v},${v + 4},${v + 8},${0.05 + rand() * 0.15})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(s, y + (rand() - 0.5) * 2);
        ctx.stroke();
      }
    },
    (ctx, s, rand) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 1200; i++) {
        const y = rand() * s;
        const v = 100 + ((rand() * 110) | 0);
        ctx.strokeStyle = `rgba(${v},${v},${v},0.12)`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(s, y);
        ctx.stroke();
      }
    },
    1.2,
    (ctx, s, rand) => {
      ctx.fillStyle = '#6a6a6a';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 900; i++) {
        const y = rand() * s;
        const v = 70 + ((rand() * 120) | 0);
        ctx.strokeStyle = `rgba(${v},${v},${v},0.2)`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(s, y);
        ctx.stroke();
      }
    }
  );
}

function concreteMaps(): MaterialMaps {
  return build(
    (ctx, s, rand) => {
      ctx.fillStyle = '#9a9a92';
      ctx.fillRect(0, 0, s, s);
      blobs(ctx, s, rand, [0xa8a8a0, 0x86867e, 0xb4b4ac, 0x767670], 260, 0.03, 0.14, 0.4);
      for (let i = 0; i < 3000; i++) {
        const x = rand() * s;
        const y = rand() * s;
        const v = 0x60 + ((rand() * 0x60) | 0);
        ctx.fillStyle = `rgba(${v},${v},${v - 4},0.4)`;
        ctx.fillRect(x, y, 1, 1);
      }
    },
    (ctx, s, rand) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, s, s);
      blobs(ctx, s, rand, [0xa0a0a0, 0x606060, 0xc0c0c0], 240, 0.03, 0.12, 0.5);
    },
    1.8
  );
}

// Near-white weave so material.color tints it (used for enemies).
function fabricMaps(): MaterialMaps {
  return build(
    (ctx, s, rand) => {
      ctx.fillStyle = '#cfcfcf';
      ctx.fillRect(0, 0, s, s);
      blobs(ctx, s, rand, [0xe0e0e0, 0xb8b8b8, 0xf0f0f0, 0xa8a8a8], 200, 0.03, 0.12, 0.4);
      for (let i = 0; i < s; i += 3) {
        ctx.strokeStyle = 'rgba(120,120,120,0.18)';
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, s);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(s, i);
        ctx.stroke();
      }
    },
    (ctx, s, rand) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, s, s);
      blobs(ctx, s, rand, [0x9a9a9a, 0x666666, 0xb0b0b0], 160, 0.03, 0.1, 0.5);
      for (let i = 0; i < s; i += 3) {
        ctx.strokeStyle = 'rgba(60,60,60,0.25)';
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, s);
        ctx.stroke();
      }
    },
    1.6
  );
}

// ── Cached accessors ────────────────────────────────────────────────────────

type Key =
  | 'grass'
  | 'dirt'
  | 'bark'
  | 'foliage'
  | 'wood'
  | 'roof'
  | 'metal'
  | 'concrete'
  | 'fabric';

const cache = new Map<Key, MaterialMaps>();
const builders: Record<Key, () => MaterialMaps> = {
  grass: grassMaps,
  dirt: dirtMaps,
  bark: barkMaps,
  foliage: foliageMaps,
  wood: woodMaps,
  roof: roofMaps,
  metal: metalMaps,
  concrete: concreteMaps,
  fabric: fabricMaps,
};

export function getMaps(key: Key): MaterialMaps {
  let m = cache.get(key);
  if (!m) {
    m = builders[key]();
    cache.set(key, m);
  }
  return m;
}

// Convenience: build a MeshStandardMaterial from a cached material set.
export function standardMaterial(
  key: Key,
  opts: {
    rx?: number;
    ry?: number;
    color?: number;
    roughness?: number;
    metalness?: number;
    normalScale?: number;
  } = {}
): THREE.MeshStandardMaterial {
  const base = getMaps(key);
  const rx = opts.rx ?? 1;
  const ry = opts.ry ?? 1;
  const m = rx === 1 && ry === 1 ? base : tile(base, rx, ry);
  const mat = new THREE.MeshStandardMaterial({
    map: m.map,
    normalMap: m.normalMap,
    // Only hand three the roughness map when the set has one: several sets
    // (metal, concrete) do not carry one, and three warns once per material when
    // the property is present but undefined.
    ...(m.roughnessMap ? { roughnessMap: m.roughnessMap } : {}),
    color: opts.color ?? 0xffffff,
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 0,
  });
  if (opts.normalScale !== undefined) {
    mat.normalScale = new THREE.Vector2(opts.normalScale, opts.normalScale);
  }
  return mat;
}


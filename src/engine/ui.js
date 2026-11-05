import * as THREE from 'three';

export const DISPLAY = '"Anton", Impact, "Arial Narrow", sans-serif';
export const BODY = '"Barlow", "Segoe UI", system-ui, sans-serif';
const PPM = 420; // canvas pixels per meter of panel

/** A flat rectangle in the world you can draw on with the 2D canvas API. */
export class Panel extends THREE.Mesh {
  constructor({ width = 1.6, height = 0.9, ppm = PPM, side = THREE.FrontSide } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * ppm);
    canvas.height = Math.ceil(height * ppm);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    super(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, fog: false, side }),
    );
    this.g = canvas.getContext('2d');
    this.W = canvas.width;
    this.H = canvas.height;
    this.ppm = ppm;
    this.lastCard = '';
  }

  paint(fn) {
    this.g.clearRect(0, 0, this.W, this.H);
    fn(this.g, this.W, this.H);
    this.material.map.needsUpdate = true;
    return this;
  }

  /** Draws a stitched label. Repaints only when the content changed. */
  card({ title = '', body = '', accent = '#ff5c4d' }) {
    const key = `${title}|${body}|${accent}`;
    if (key !== this.lastCard) {
      this.lastCard = key;
      this.paint((g, W, H) => drawCard(g, W, H, this.ppm, { title, body, accent }));
    }
    return this;
  }
}

export function wrapText(g, text, maxWidth) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

const TITLE_M = 0.125;
const BODY_M = 0.07;
const PAD_M = 0.1;
const LEADING = 1.32;

function drawCard(g, W, H, ppm, { title, body, accent }) {
  const pad = PAD_M * ppm;
  g.fillStyle = 'rgba(7,22,31,0.94)';
  g.fillRect(0, 0, W, H);
  g.fillStyle = accent;
  g.fillRect(0, 0, W, 0.012 * ppm);

  g.textBaseline = 'top';
  let y = pad;
  if (title) {
    g.fillStyle = accent;
    g.font = `${TITLE_M * ppm}px ${DISPLAY}`;
    for (const line of wrapText(g, title, W - pad * 2)) {
      g.fillText(line, pad, y);
      y += TITLE_M * ppm * 1.18;
    }
    y += 0.02 * ppm;
  }
  if (body) {
    g.fillStyle = '#f4efe2';
    g.font = `${BODY_M * ppm}px ${BODY}`;
    for (const line of wrapText(g, body, W - pad * 2)) {
      g.fillText(line, pad, y);
      y += BODY_M * ppm * LEADING;
    }
  }
}

const measure = document.createElement('canvas').getContext('2d');

/** The height a card needs for its text at a given width, in meters. */
export function cardHeight({ title = '', body = '', width = 1.6 }) {
  const inner = (width - PAD_M * 2) * PPM;
  let h = PAD_M * 2;
  if (title) {
    measure.font = `${TITLE_M * PPM}px ${DISPLAY}`;
    h += wrapText(measure, title, inner).length * TITLE_M * 1.18 + 0.02;
  }
  if (body) {
    measure.font = `${BODY_M * PPM}px ${BODY}`;
    h += wrapText(measure, body, inner).length * BODY_M * LEADING;
  }
  return h;
}

export function makeCard(opts) {
  const width = opts.width ?? 1.6;
  return new Panel({ width, height: cardHeight({ ...opts, width }), side: opts.side }).card(opts);
}

export function makeButtonFace(label, accent = '#ff5c4d', width = 0.72) {
  const height = 0.2;
  const panel = new Panel({ width, height, ppm: 500 });
  panel.paint((g, W, H) => {
    g.fillStyle = accent;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#07161f';
    g.font = `${0.086 * 500}px ${DISPLAY}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, W / 2, H / 2 + 2);
  });
  return panel;
}

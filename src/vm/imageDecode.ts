export interface J2MEImageData {
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
  img?: HTMLImageElement;
  ready: boolean;
}

export function sniffImageDimensions(bytes: Uint8Array): { width: number; height: number } {
  // PNG: 89 50 4E 47 ... IHDR width at 16..19, height at 20..23
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    if (w > 0 && h > 0 && w < 8192 && h < 8192) {
      return { width: w, height: h };
    }
  }

  // GIF: GIF87a / GIF89a, width at 6..7 LE, height at 8..9 LE
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    const w = bytes[6] | (bytes[7] << 8);
    const h = bytes[8] | (bytes[9] << 8);
    if (w > 0 && h > 0) return { width: w, height: h };
  }

  // JPEG: scan SOF0..SOF2 markers
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const h = (bytes[i + 5] << 8) | bytes[i + 6];
        const w = (bytes[i + 7] << 8) | bytes[i + 8];
        if (w > 0 && h > 0) return { width: w, height: h };
        break;
      }
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x00) {
        i += 2;
        continue;
      }
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (len < 2) break;
      i += 2 + len;
    }
  }

  return { width: 16, height: 16 };
}

export function detectImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  return 'image/png';
}

export function createImageFromBytes(
  bytes: Uint8Array,
  onDecoded?: () => void
): J2MEImageData {
  const { width, height } = sniffImageDimensions(bytes);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: detectImageMime(bytes) });
  const url = URL.createObjectURL(blob);
  const img = new Image();

  const data: J2MEImageData = {
    width,
    height,
    canvas,
    img,
    ready: false,
  };

  img.onload = () => {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      data.width = img.naturalWidth;
      data.height = img.naturalHeight;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    }
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    }
    data.ready = true;
    URL.revokeObjectURL(url);
    if (onDecoded) onDecoded();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
  };
  img.src = url;

  return data;
}

export function createBlankImage(width: number, height: number): J2MEImageData {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
  }
  return { width: w, height: h, canvas, ready: true };
}

export function createRgbImage(rgb: number[], width: number, height: number, processAlpha: boolean): J2MEImageData {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const imgData = ctx.createImageData(w, h);
    const out = imgData.data;
    const len = Math.min(rgb.length, w * h);
    for (let i = 0; i < len; i++) {
      const px = rgb[i] | 0;
      const a = processAlpha ? (px >>> 24) & 0xff : 255;
      const r = (px >>> 16) & 0xff;
      const g = (px >>> 8) & 0xff;
      const b = px & 0xff;
      const o = i * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
    ctx.putImageData(imgData, 0, 0);
  }
  return { width: w, height: h, canvas, ready: true };
}

// MIDP Sprite transforms
export const TRANS_NONE = 0;
export const TRANS_MIRROR_ROT180 = 1;
export const TRANS_MIRROR = 2;
export const TRANS_ROT180 = 3;
export const TRANS_MIRROR_ROT270 = 4;
export const TRANS_ROT90 = 5;
export const TRANS_ROT270 = 6;
export const TRANS_MIRROR_ROT90 = 7;

export function drawTransformedRegion(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement | HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  transform: number,
  dx: number,
  dy: number
) {
  if (sw <= 0 || sh <= 0) return;
  const swapDims =
    transform === TRANS_ROT90 ||
    transform === TRANS_ROT270 ||
    transform === TRANS_MIRROR_ROT90 ||
    transform === TRANS_MIRROR_ROT270;
  const dw = swapDims ? sh : sw;
  const dh = swapDims ? sw : sh;

  ctx.save();
  ctx.translate(dx + dw / 2, dy + dh / 2);

  switch (transform) {
    case TRANS_MIRROR:
      ctx.scale(-1, 1);
      break;
    case TRANS_ROT180:
      ctx.rotate(Math.PI);
      break;
    case TRANS_MIRROR_ROT180:
      ctx.scale(1, -1);
      break;
    case TRANS_ROT90:
      ctx.rotate(Math.PI / 2);
      break;
    case TRANS_ROT270:
      ctx.rotate(-Math.PI / 2);
      break;
    case TRANS_MIRROR_ROT90:
      ctx.scale(-1, 1);
      ctx.rotate(Math.PI / 2);
      break;
    case TRANS_MIRROR_ROT270:
      ctx.scale(-1, 1);
      ctx.rotate(-Math.PI / 2);
      break;
    default:
      break;
  }

  ctx.drawImage(src, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
}

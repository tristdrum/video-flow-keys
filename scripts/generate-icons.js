const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const sizes = [16, 32, 48, 128, 256, 512];
const outputDir = path.join(__dirname, "..", "web-extension", "icons");

fs.mkdirSync(outputDir, { recursive: true });

for (const size of sizes) {
  const pixels = new Uint8Array(size * size * 4);
  drawIcon(pixels, size);
  fs.writeFileSync(path.join(outputDir, `icon-${size}.png`), encodePng(pixels, size, size));
}

function drawIcon(pixels, size) {
  const radius = size * 0.22;
  const inset = Math.max(1, Math.floor(size * 0.04));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = insideRoundedRect(x, y, inset, inset, size - inset * 2, size - inset * 2, radius);
      if (!inside) {
        setPixel(pixels, size, x, y, [0, 0, 0, 0]);
        continue;
      }

      const t = (x + y) / (size * 2);
      setPixel(pixels, size, x, y, lerpColor([14, 20, 32, 255], [24, 64, 82, 255], t));
    }
  }

  drawTriangle(pixels, size, [
    [size * 0.34, size * 0.28],
    [size * 0.34, size * 0.72],
    [size * 0.68, size * 0.5]
  ], [248, 250, 252, 255]);

  drawBar(pixels, size, size * 0.18, size * 0.68, size * 0.16, size * 0.06, [45, 212, 191, 255]);
  drawBar(pixels, size, size * 0.2, size * 0.78, size * 0.28, size * 0.06, [56, 189, 248, 255]);
  drawBar(pixels, size, size * 0.22, size * 0.88, size * 0.42, size * 0.06, [129, 140, 248, 255]);
}

function drawBar(pixels, size, left, centerY, width, height, color) {
  const x0 = Math.floor(left);
  const x1 = Math.ceil(left + width);
  const y0 = Math.floor(centerY - height / 2);
  const y1 = Math.ceil(centerY + height / 2);

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (x >= 0 && y >= 0 && x < size && y < size) {
        setPixel(pixels, size, x, y, color);
      }
    }
  }
}

function drawTriangle(pixels, size, points, color) {
  const minX = Math.floor(Math.min(...points.map((point) => point[0])));
  const maxX = Math.ceil(Math.max(...points.map((point) => point[0])));
  const minY = Math.floor(Math.min(...points.map((point) => point[1])));
  const maxY = Math.ceil(Math.max(...points.map((point) => point[1])));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (pointInTriangle(x + 0.5, y + 0.5, points)) {
        setPixel(pixels, size, x, y, color);
      }
    }
  }
}

function pointInTriangle(x, y, points) {
  const [a, b, c] = points;
  const area = triangleArea(a, b, c);
  const area1 = triangleArea([x, y], b, c);
  const area2 = triangleArea(a, [x, y], c);
  const area3 = triangleArea(a, b, [x, y]);

  return Math.abs(area - (area1 + area2 + area3)) < 0.75;
}

function triangleArea(a, b, c) {
  return Math.abs((a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])) / 2);
}

function insideRoundedRect(x, y, left, top, width, height, radius) {
  const right = left + width;
  const bottom = top + height;
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  const dx = x - cx;
  const dy = y - cy;

  return x >= left && x <= right && y >= top && y <= bottom && dx * dx + dy * dy <= radius * radius;
}

function setPixel(pixels, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return;
  }

  const index = (Math.floor(y) * size + Math.floor(x)) * 4;
  pixels[index] = color[0];
  pixels[index + 1] = color[1];
  pixels[index + 2] = color[2];
  pixels[index + 3] = color[3];
}

function lerpColor(a, b, t) {
  return a.map((channel, index) => Math.round(channel + (b[index] - channel) * t));
}

function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", Buffer.concat([
      uint32(width),
      uint32(height),
      Buffer.from([8, 6, 0, 0, 0])
    ])),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const body = Buffer.concat([typeBuffer, data]);

  return Buffer.concat([
    uint32(data.length),
    body,
    uint32(crc32(body))
  ]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

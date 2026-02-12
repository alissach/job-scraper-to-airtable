import sharp from "sharp";
import { mkdirSync } from "fs";

const outputDir = "/vercel/share/v0-project/chrome-extension/icons";
mkdirSync(outputDir, { recursive: true });

const sizes = [16, 48, 128];

for (const size of sizes) {
  // Create a blue square with a white briefcase-like shape using SVG
  const padding = Math.round(size * 0.15);
  const iconSize = size - padding * 2;
  const radius = Math.round(size * 0.15);

  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${radius}" fill="#2563eb"/>
      <g transform="translate(${padding}, ${padding})">
        <rect x="${iconSize * 0.1}" y="${iconSize * 0.3}" width="${iconSize * 0.8}" height="${iconSize * 0.6}" rx="${iconSize * 0.08}" fill="white"/>
        <rect x="${iconSize * 0.32}" y="${iconSize * 0.1}" width="${iconSize * 0.36}" height="${iconSize * 0.3}" rx="${iconSize * 0.06}" fill="none" stroke="white" stroke-width="${Math.max(1, iconSize * 0.08)}"/>
        <rect x="${iconSize * 0.38}" y="${iconSize * 0.5}" width="${iconSize * 0.24}" height="${iconSize * 0.14}" rx="${iconSize * 0.03}" fill="#2563eb"/>
      </g>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .png()
    .toFile(`${outputDir}/icon${size}.png`);

  console.log(`Generated icon${size}.png`);
}

console.log("All icons generated!");

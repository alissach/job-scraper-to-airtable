import sharp from "sharp";
import { mkdirSync } from "fs";
import { join } from "path";

const outDir = join(process.cwd(), "chrome-extension", "icons");
mkdirSync(outDir, { recursive: true });

const sizes = [16, 48, 128];

for (const size of sizes) {
  // Create a blue square with a white briefcase-like shape
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" rx="${Math.round(size * 0.15)}" fill="#2563eb"/>
    <g transform="translate(${size * 0.2}, ${size * 0.25}) scale(${size * 0.006})">
      <path d="M80 15H60V5c0-2.8-2.2-5-5-5H45c-2.8 0-5 2.2-5 5v10H20c-5.5 0-10 4.5-10 10v10h100V25c0-5.5-4.5-10-10-10zM55 15H45V7h10v8zM10 45v35c0 5.5 4.5 10 10 10h60c5.5 0 10-4.5 10-10V45H10z" fill="white"/>
    </g>
  </svg>`;

  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(join(outDir, `icon${size}.png`));

  console.log(`Generated icon${size}.png`);
}

console.log("All icons generated!");

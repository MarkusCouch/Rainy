const UNIVERSAL_BLUE = [
  "636159", "66635a", "69665c", "6c685d", "6f6b5f", "726e61", "757062", "787364",
  "7c7565", "7f7867", "827b69", "857d6a", "88806c", "8b826d", "8e856f", "928871",
  "9e9375", "aa9e79", "b6a97e", "c2b482", "cec087", "d2c48b", "d6c88f", "dacc93",
  "ded097", "88ddee", "6cd1eb", "51c5e8", "36bae5", "1baee2", "00a3e0", "009ad5",
  "0091ca", "0088bf", "007fb4", "0077aa", "0070a3", "00699c", "006295", "005b8e",
  "005588", "005180", "004e78", "004a70", "004768", "ffee00", "ffe000", "ffd200",
  "ffc500", "ffb700", "ffaa00", "ff9f00", "ff9500", "ff8b00", "ff8100", "ff4400",
  "f23600", "e62800", "d91b00", "cd0d00", "c10000", "a80000", "8f0000", "760000",
  "5d0000", "ffaaff", "ff9fff", "ff95ff", "ff8bff", "ff81ff", "ff77ff", "ff6cff",
  "ff62ff", "ff58ff", "ff4eff", "ffffff", "ffffff", "ffffff", "ffffff", "ffffff",
  "ffffff", "ffffff", "ffffff", "ffffff", "ffffff", "00ff00", "00ff00", "00ff00",
  "00ff00", "00ff00", "00ff00", "00ff00", "00ff00", "00ff00", "00ff00", "00ff00",
  "00ff00", "00ff00", "00ff00", "00ff00", "00ff00", "00ff00", "00ff00", "00ff00",
  "00ff00", "00ff00"
];

const colorToDbz = new Map();
UNIVERSAL_BLUE.forEach((hex, index) => {
  colorToDbz.set(Number.parseInt(hex, 16), index - 10);
});

export const RADAR_CLASSES = [
  { max: 9, color: [155, 231, 160], alpha: 104, label: "schwaches Echo" },
  { max: 19, color: [35, 201, 107], alpha: 174, label: "leicht / Niesel" },
  { max: 34, color: [244, 209, 61], alpha: 194, label: "mäßig" },
  { max: 44, color: [242, 140, 40], alpha: 210, label: "stark" },
  { max: Infinity, color: [234, 59, 53], alpha: 224, label: "sehr stark" }
];

export function rgbToDbz(r, g, b, alpha = 255) {
  if (alpha === 0) return null;
  const key = (r << 16) | (g << 8) | b;
  return colorToDbz.get(key) ?? null;
}

export function radarClassForDbz(dbz) {
  if (dbz == null) return null;
  return RADAR_CLASSES.find((entry) => dbz <= entry.max) ?? RADAR_CLASSES.at(-1);
}

export function recolorRadarImageData(imageData) {
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const dbz = rgbToDbz(data[i], data[i + 1], data[i + 2], data[i + 3]);
    const radarClass = radarClassForDbz(dbz);
    if (!radarClass) {
      data[i + 3] = 0;
      continue;
    }

    data[i] = radarClass.color[0];
    data[i + 1] = radarClass.color[1];
    data[i + 2] = radarClass.color[2];
    data[i + 3] = dbz < 0 ? 50 : radarClass.alpha;
  }
  return imageData;
}

export function decodeRadarImageData(imageData) {
  const { data, width, height } = imageData;
  const values = new Int16Array(width * height);
  values.fill(-999);

  for (let pixel = 0, i = 0; i < data.length; i += 4, pixel += 1) {
    const dbz = rgbToDbz(data[i], data[i + 1], data[i + 2], data[i + 3]);
    if (dbz != null) values[pixel] = dbz;
  }
  return { values, width, height };
}

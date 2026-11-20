const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const HorizonBands = require('../src/horizon-bands.js');

function readHorizonBands(file) {
  const folder = path.dirname(path.resolve(file));
  const source = JSON.parse(fs.readFileSync(file, 'utf8'));
  const images = new Map();
  return HorizonBands.compile(source, { readImage(filename) {
    const full = path.resolve(folder, filename);
    if (!images.has(full)) {
      const { w, h, data, max } = PNG.raster(full);
      images.set(full, { width:w, height:h, pixels:max === 255 ? data : Uint8Array.from(data, sample => Math.round(sample * 255 / max)) });
    }
    return images.get(full);
  } }) ?? false;
}
module.exports = { readHorizonBands };

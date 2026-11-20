const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ColorLUT = require('../src/color-lut.js');

function read(file) {
  if (typeof file !== 'string' || !/\.(cube|json)$/i.test(file))
    throw new TypeError('Expected a .cube or .json LUT file');
  const text = fs.readFileSync(path.resolve(file), 'utf8');
  return /\.cube$/i.test(file) ? ColorLUT.parseCube(text) : ColorLUT.normalize(JSON.parse(text));
}

function write(file, definition) {
  const target = path.resolve(file), temporary = target + '.' + randomUUID() + '.tmp';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(temporary, JSON.stringify(definition) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function override(value) {
  return value === undefined ? undefined : value === 'off' ? false : read(value);
}

module.exports = { read, write, override };

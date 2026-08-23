'use strict';

const assert = require('node:assert');
const fs = require('node:fs');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

assert.strictEqual(manifest.version, '1.1.1');

function readPngHeader(path) {
  assert.strictEqual(fs.existsSync(path), true);
  const data = fs.readFileSync(path);
  assert.strictEqual(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.strictEqual(data.subarray(12, 16).toString('ascii'), 'IHDR');
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    bitDepth: data[24],
    colorType: data[25]
  };
}

assert.strictEqual(fs.existsSync('assets/icons/icon-source.png'), true);
assert.strictEqual(fs.existsSync('assets/icons/icon.svg'), false);
assert.strictEqual(manifest.action.default_icon['16'], 'assets/icons/icon16.png');
assert.strictEqual(manifest.action.default_icon['48'], 'assets/icons/icon48.png');
assert.strictEqual(manifest.action.default_icon['128'], 'assets/icons/icon128.png');
assert.strictEqual(manifest.content_scripts[0].css[0], 'lib/bridge-ui.css');
assert.deepStrictEqual(readPngHeader('assets/icons/icon-source.png'), {
  width: 1024,
  height: 1024,
  bitDepth: 8,
  colorType: 6
});
assert.deepStrictEqual(readPngHeader(manifest.icons['16']), {
  width: 16,
  height: 16,
  bitDepth: 8,
  colorType: 6
});
assert.deepStrictEqual(readPngHeader(manifest.icons['48']), {
  width: 48,
  height: 48,
  bitDepth: 8,
  colorType: 6
});
assert.deepStrictEqual(readPngHeader(manifest.icons['128']), {
  width: 128,
  height: 128,
  bitDepth: 8,
  colorType: 6
});

console.log('PASS manifest icons are wired to generated PNG assets with raster source and bridge CSS');

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

function assertPngIcon(path) {
  assert.strictEqual(fs.existsSync(path), true);
  assert.strictEqual(fs.readFileSync(path).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
}

assert.strictEqual(fs.existsSync('assets/icons/icon.svg'), true);
assert.strictEqual(manifest.action.default_icon['16'], 'assets/icons/icon16.png');
assert.strictEqual(manifest.action.default_icon['48'], 'assets/icons/icon48.png');
assert.strictEqual(manifest.action.default_icon['128'], 'assets/icons/icon128.png');
assertPngIcon(manifest.icons['16']);
assertPngIcon(manifest.icons['48']);
assertPngIcon(manifest.icons['128']);

console.log('PASS manifest icons are wired to generated PNG assets with SVG source retained');

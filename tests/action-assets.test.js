const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const actionArt = require('../utils/action-art');
const actionAvatar = require('../utils/action-avatar');
const manifest = require('../assets/battle/manifest');
const { FAMILIES } = require('../utils/content');
const { ENEMY_BY_ID } = require('../utils/combat-content');

const root = path.resolve(__dirname, '..');
const states = actionArt.STATES;
const heroIds = FAMILIES.map(item => item.id);
const catalog = [...heroIds, ...actionArt.BOSSES.flatMap(id => [id, `${id}-phase2`])];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a, b, c) {
  const estimate = a + b - c;
  const pa = Math.abs(estimate - a);
  const pb = Math.abs(estimate - b);
  const pc = Math.abs(estimate - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodeIndexedPng(file) {
  const source = fs.readFileSync(file);
  assert.ok(source.subarray(0, 8).equals(PNG_SIGNATURE), `${file} 不是 PNG`);
  let offset = 8;
  let header;
  let palette;
  let transparency = Buffer.alloc(0);
  const imageData = [];
  while (offset < source.length) {
    const length = source.readUInt32BE(offset);
    const type = source.toString('ascii', offset + 4, offset + 8);
    const chunk = source.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      header = {
        width: chunk.readUInt32BE(0),
        height: chunk.readUInt32BE(4),
        bitDepth: chunk[8],
        colorType: chunk[9],
        interlace: chunk[12]
      };
    } else if (type === 'PLTE') {
      palette = chunk;
    } else if (type === 'tRNS') {
      transparency = chunk;
    } else if (type === 'IDAT') {
      imageData.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
  }
  assert.ok(header, `${file} 缺少 IHDR`);
  assert.equal(header.bitDepth, 8, `${file} 不是 8-bit PNG`);
  assert.equal(header.colorType, 3, `${file} 不是 128 色 indexed PNG`);
  assert.equal(header.interlace, 0, `${file} 使用了不支持的交错 PNG`);
  assert.ok(palette && palette.length % 3 === 0, `${file} 缺少有效 PLTE`);

  const rowBytes = header.width;
  const raw = zlib.inflateSync(Buffer.concat(imageData));
  const indexed = Buffer.alloc(rowBytes * header.height);
  const previous = Buffer.alloc(rowBytes);
  let rawOffset = 0;
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[rawOffset++];
    const encoded = raw.subarray(rawOffset, rawOffset + rowBytes);
    rawOffset += rowBytes;
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x ? row[x - 1] : 0;
      const up = previous[x];
      const upperLeft = x ? previous[x - 1] : 0;
      let value;
      if (filter === 0) value = encoded[x];
      else if (filter === 1) value = (encoded[x] + left) & 255;
      else if (filter === 2) value = (encoded[x] + up) & 255;
      else if (filter === 3) value = (encoded[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) value = (encoded[x] + paeth(left, up, upperLeft)) & 255;
      else throw new Error(`${file} 使用未知 PNG filter ${filter}`);
      row[x] = value;
    }
    row.copy(indexed, y * rowBytes);
    row.copy(previous);
  }

  const rgba = Buffer.alloc(indexed.length * 4);
  for (let index = 0; index < indexed.length; index += 1) {
    const paletteIndex = indexed[index];
    const paletteOffset = paletteIndex * 3;
    assert.ok(paletteOffset + 2 < palette.length, `${file} 的 palette index 越界`);
    const rgbaOffset = index * 4;
    rgba[rgbaOffset] = palette[paletteOffset];
    rgba[rgbaOffset + 1] = palette[paletteOffset + 1];
    rgba[rgbaOffset + 2] = palette[paletteOffset + 2];
    rgba[rgbaOffset + 3] = paletteIndex < transparency.length ? transparency[paletteIndex] : 255;
  }
  return { ...header, rgba };
}

function imagePath(id, state) {
  const group = Object.keys(actionArt.GROUPS).find(name => actionArt.GROUPS[name].includes(id));
  if (group) return path.join(root, `package-actors-${group}`, 'assets', id, `${state}.png`);
  const baseId = id.replace(/-phase2$/, '');
  return path.join(root, `package-${ENEMY_BY_ID[baseId].regionId}`, 'assets', 'actions', id, `${state}.png`);
}

test('28 个身份的 224 个 runtime 目标文件均存在、可解码且不超过 256px', () => {
  assert.equal(catalog.length, 28);
  const files = [];
  for (const id of catalog) {
    const hashes = new Set();
    for (const state of states) {
      const file = imagePath(id, state);
      files.push(file);
      assert.ok(fs.existsSync(file), `缺少 ${id}/${state}`);
      const image = decodeIndexedPng(file);
      assert.ok(image.width > 0 && image.height > 0);
      assert.ok(image.width <= 256 && image.height <= 256, `${id}/${state} 尺寸 ${image.width}x${image.height} 超过 256px`);
      const hash = crypto.createHash('sha256')
        .update(`${image.width}x${image.height}\0`)
        .update(image.rgba)
        .digest('hex');
      hashes.add(hash);
    }
    assert.equal(hashes.size, 8, `${id} 的 8 个状态存在重复像素内容`);
  }
  assert.equal(files.length, 224);
  assert.equal(new Set(files).size, 224);
});

test('动作路径和组件观察器与三组伙伴包、三阶段 Boss 包一致', async () => {
  for (const id of heroIds) {
    const group = actionArt.heroGroup(id);
    assert.ok(group);
    assert.equal(actionArt.imageFor({ id }, 'street', 'idle'), manifest.heroes[id].idle);
    for (const state of states) {
      assert.equal(actionArt.imageFor({ id }, 'street', state), `/package-actors-${group}/assets/${id}/${state}.png`);
      const component = actionAvatar.definition(group);
      const host = { data: { src: '' }, setData(value) { this.data = { ...this.data, ...value }; } };
      component.observers['actor,state,base'].call(host, id, state, '/fallback.png');
      assert.equal(host.data.src, `/package-actors-${group}/assets/${id}/${state}.png`);
      component.observers['actor,state,base'].call(host, 'unknown', state, '/fallback.png');
      assert.equal(host.data.src, '/fallback.png');
    }
  }

  for (const [id, regionId] of [['paper-lion', 'street'], ['ink-tide', 'bridge'], ['bell-warden', 'market']]) {
    assert.equal(actionArt.imageFor({ definitionId: id, phase: 1 }, regionId, 'attack'), `/package-${regionId}/assets/actions/${id}/attack.png`);
    assert.equal(actionArt.imageFor({ definitionId: id, phase: 2 }, regionId, 'attack'), `/package-${regionId}/assets/actions/${id}-phase2/attack.png`);
  }

  const loaded = [];
  await actionAvatar.loadActionPacks({
    a: () => { loaded.push('a'); return Promise.resolve(); },
    b: () => { loaded.push('b'); return Promise.resolve(); },
    c: () => { loaded.push('c'); return Promise.resolve(); }
  }, [...heroIds.map(id => ({ id })), { id: 'paper-lion' }]);
  assert.deepEqual(loaded, ['a', 'b', 'c']);
});

test('主包保留 22 张 idle，22 张旧 cast 均归档且不再留在主包', () => {
  const partnerDir = path.join(root, 'assets', 'partners');
  const idleFiles = fs.readdirSync(partnerDir).filter(file => file.endsWith('.png')).sort();
  assert.deepEqual(idleFiles, heroIds.map(id => `${id}.png`).sort());

  const legacyDir = path.join(root, 'docs', 'combat-motion', 'legacy-casts');
  const legacyFiles = fs.readdirSync(legacyDir).filter(file => file.endsWith('-cast.png')).sort();
  assert.deepEqual(legacyFiles, heroIds.map(id => `${id}-cast.png`).sort());
  assert.equal(idleFiles.length, 22);
  assert.equal(legacyFiles.length, 22);
});

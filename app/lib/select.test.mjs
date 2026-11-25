import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectLabel, placeMenu, placeCtxMenu } from './select.js';

test('selectLabel reads the selected option text', () => {
  assert.equal(selectLabel({
    selectedOptions: [{ textContent: '  main  ' }],
    options: [],
    selectedIndex: 0,
  }), 'main');
  assert.equal(selectLabel({
    selectedOptions: null,
    options: [{ textContent: 'Auto' }, { textContent: 'develop' }],
    selectedIndex: 1,
  }), 'develop');
  assert.equal(selectLabel({ selectedOptions: [], options: [], selectedIndex: -1 }), '');
});

function fakeEl({ width = 200, height = 120 } = {}) {
  const style = {};
  return {
    style,
    offsetWidth: width,
    offsetHeight: height,
  };
}

test('placeMenu keeps a wide menu inside the right edge', () => {
  const menu = fakeEl({ width: 280, height: 100 });
  const trigger = {
    getBoundingClientRect: () => ({ left: 900, right: 1000, top: 100, bottom: 124, width: 100, height: 24 }),
  };
  placeMenu(menu, trigger, { viewW: 1100, viewH: 800, pad: 8 });
  const left = Number.parseFloat(menu.style.left);
  const top = Number.parseFloat(menu.style.top);
  assert.ok(left + 280 <= 1100 - 8, `left ${left} + width spills past viewport`);
  assert.ok(left >= 8);
  assert.equal(top, 128); // below trigger
});

test('placeMenu flips above when there is no room below', () => {
  const menu = fakeEl({ width: 160, height: 200 });
  const trigger = {
    getBoundingClientRect: () => ({ left: 40, right: 140, top: 700, bottom: 724, width: 100, height: 24 }),
  };
  placeMenu(menu, trigger, { viewW: 800, viewH: 760, pad: 8 });
  const top = Number.parseFloat(menu.style.top);
  assert.ok(top < 700, `expected flip above, got top ${top}`);
  assert.ok(top + 200 <= 760);
});

test('placeCtxMenu flips above when the click is near the bottom', () => {
  const menu = fakeEl({ width: 180, height: 220 });
  placeCtxMenu(menu, 40, 700, { viewW: 800, viewH: 760, pad: 8 });
  const top = Number.parseFloat(menu.style.top);
  const left = Number.parseFloat(menu.style.left);
  assert.ok(top < 700, `expected flip above click, got top ${top}`);
  assert.ok(top >= 8);
  assert.ok(top + 220 <= 760 - 8);
  assert.equal(left, 40);
});

test('placeCtxMenu keeps a wide menu inside the right edge', () => {
  const menu = fakeEl({ width: 240, height: 100 });
  placeCtxMenu(menu, 900, 100, { viewW: 1000, viewH: 800, pad: 8 });
  const left = Number.parseFloat(menu.style.left);
  assert.ok(left + 240 <= 1000 - 8, `left ${left} + width spills past viewport`);
  assert.ok(left >= 8);
});

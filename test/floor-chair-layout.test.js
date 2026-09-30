const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const browser = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'floor-chair-layout.js'), 'utf8'), { window: browser, Object, Math, Number });
const { layout } = browser.WestoFloorChairLayout;
const DIMENSIONS = { circle: [76, 76], rectangle: [104, 68], square: [58, 58] };

function sideClearance(shape, chair) {
  const [width, height] = DIMENSIONS[shape];
  if (chair.side === 'north') return -chair.y * height / 100 - chair.height / 2;
  if (chair.side === 'south') return (chair.y - 100) * height / 100 - chair.height / 2;
  if (chair.side === 'east') return (chair.x - 100) * width / 100 - chair.height / 2;
  return -chair.x * width / 100 - chair.height / 2;
}

test('square table seats are balanced across four sides', () => {
  const chairs = layout({ shape: 'square', seats: 9 }).chairs;
  assert.equal(chairs.length, 9);
  assert.deepEqual(Object.fromEntries(['north', 'south', 'east', 'west'].map(side => [side, chairs.filter(chair => chair.side === side).length])), { north: 3, south: 2, east: 2, west: 2 });
});

test('square chairs keep a clear margin outside the table at default and custom chair sizes', () => {
  for (const chairScale of [1, 1.5]) {
    const chairs = layout({ shape: 'square', seats: 4, chairScale }).chairs;
    assert.equal(chairs.length, 4);
    assert.ok(chairs.every(chair => sideClearance('square', chair) >= 5.9));
  }
});

test('round and oval seats follow their perimeter with the requested model', () => {
  const result = layout({ shape: 'oval', seats: 6, chairModel: 'armchair' });
  assert.equal(result.chairs.length, 6);
  assert.ok(result.chairs.every(chair => chair.x < 25 || chair.x > 75 || chair.y < 25 || chair.y > 75));
  assert.match(result.markup, /plan-chair--armchair/);
});

test('four round-table seats align to top, right, bottom, and left', () => {
  const chairs = layout({ shape: 'circle', seats: 4 }).chairs;
  assert.equal(chairs.filter(chair => Math.abs(chair.x - 50) < 0.1).length, 2);
  assert.equal(chairs.filter(chair => Math.abs(chair.y - 50) < 0.1).length, 2);
  assert.ok(chairs.every(chair => {
    const radialDistance = Math.hypot((chair.x - 50) * 0.76, (chair.y - 50) * 0.76);
    return radialDistance - 38 - chair.height / 2 >= 5.9;
  }));
});

test('two-seat circular tables keep chairs on the left and right of the label', () => {
  const chairs = layout({ shape: 'circle', seats: 2 }).chairs;
  assert.equal(chairs.length, 2);
  assert.ok(chairs.every(chair => Math.abs(chair.y - 50) < 0.1));
  assert.ok(chairs.some(chair => chair.x < 50));
  assert.ok(chairs.some(chair => chair.x > 50));
});

test('rectangular tables balance side rows and use head seats for larger capacities', () => {
  const result = layout({ shape: 'rectangle', seats: 6 });
  assert.deepEqual(Object.fromEntries(['north', 'south', 'east', 'west'].map(side => [side, result.chairs.filter(chair => chair.side === side).length])), { north: 2, south: 2, east: 1, west: 1 });
});

test('wall counter and bar stools are arranged along the service side only', () => {
  const result = layout({ shape: 'wall_counter', seats: 5 });
  assert.equal(result.chairs.length, 5);
  assert.ok(result.chairs.every(chair => chair.side === 'south' && chair.y > 100));
  assert.match(result.markup, /plan-chair--stool/);
});

test('built-in booth cushions do not acquire overlapping loose chairs', () => {
  assert.equal(layout({ shape: 'booth', seats: 6 }).chairs.length, 0);
  assert.equal(layout({ shape: 'lounge_takht', seats: 6 }).chairs.length, 0);
  assert.equal(layout({ shape: 'circle', seats: 99 }).chairs.length, 24);
});

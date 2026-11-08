const { RollCallEngine } = require('./src/logic.js');

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + msg);
  } else {
    fail++;
    console.log('  ✗ ' + msg);
  }
}

console.log('\n[1] 基本：空池返回空');
{
  const e = new RollCallEngine([]);
  const r = e.draw({ allowRepeat: true, reduceRepeat: false, drawCount: 1, attention: [] });
  assert(r.selected.length === 0, '空池 selected 为空');
}

console.log('\n[2] 超限处理：点名人数大于总人数按总人数');
{
  const e = new RollCallEngine(['A', 'B', 'C']);
  const r = e.draw({ allowRepeat: true, reduceRepeat: false, drawCount: 10, attention: [] });
  assert(r.selected.length === 3, 'drawCount=10 时抽出 3 人');
  assert(new Set(r.selected).size === 3, '3 人不重复（单次点名内不重复）');
}

console.log('\n[3] 不重复机制：关闭后不抽已抽到的人，池空才开启新一轮');
{
  const e = new RollCallEngine(['A', 'B', 'C']);
  const all = [];
  for (let i = 0; i < 3; i++) {
    const r = e.draw({ allowRepeat: false, reduceRepeat: false, drawCount: 1, attention: [] });
    all.push(r.selected[0]);
  }
  assert(new Set(all).size === 3, '连续 3 次抽到 3 个不同的人');
  assert(e.remainingPool.length === 3, '池空后自动重置剩余池为 3');
}

console.log('\n[4] 不重复 + 人数不足：剩余不足按剩余人数，不自动开下一轮');
{
  const e = new RollCallEngine(['A', 'B', 'C', 'D', 'E']);
  e.draw({ allowRepeat: false, reduceRepeat: false, drawCount: 2, attention: [] });
  const r = e.draw({ allowRepeat: false, reduceRepeat: false, drawCount: 5, attention: [] });
  assert(r.selected.length === 3, '剩余 3 人时抽 5 人只返回 3 人');
  assert(r.allPicked === true, '抽完后池空，标记本轮结束');
}

console.log('\n[5] 重点关照 · 单人周期强制（每 5 次必出）');
{
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const e = new RollCallEngine(names);
  const s = { allowRepeat: true, reduceRepeat: false, drawCount: 1, attention: ['A'] };
  let appeared = false;
  for (let i = 0; i < 5; i++) {
    const r = e.draw(s);
    if (r.selected[0] === 'A') { appeared = true; break; }
  }
  assert(appeared, '单人模式 5 次内 A 强制出现');
}

console.log('\n[6] 重点关照 · 多人周期强制（每 4 次必出）');
{
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const e = new RollCallEngine(names);
  const s = { allowRepeat: true, reduceRepeat: false, drawCount: 3, attention: ['A'] };
  let appeared = false;
  for (let i = 0; i < 4; i++) {
    const r = e.draw(s);
    if (r.selected.indexOf('A') >= 0) { appeared = true; break; }
  }
  assert(appeared, '多人模式 4 次内 A 强制出现');
}

console.log('\n[7] 重点关照 · 提前命中后本周期概率降回初始且不强制');
{
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const e = new RollCallEngine(names);
  const s = { allowRepeat: true, reduceRepeat: false, drawCount: 1, attention: ['A'] };
  // 白盒构造：A 在第 1 次已命中
  e.attentionState['A'] = { hit: true, pos: 1 };
  let ok = true;
  for (let i = 0; i < 3; i++) { // 第 2、3、4 次
    const r = e.draw(s);
    if (r.due.indexOf('A') >= 0) ok = false;
    if (e._attentionWeight(e.attentionState['A'], names.length) !== 1) ok = false;
  }
  assert(ok, '提前命中后本周期内 A 概率保持初始、不强制');
  const r5 = e.draw(s); // 第 5 次，周期末
  assert(r5.due.indexOf('A') < 0, '周期末（第 5 次）A 不被强制');
  const st = e.attentionState['A'];
  assert(st.hit === false && st.pos === 0, '周期结束后 A 状态重置');
}

console.log('\n[8] 降低重复率：全局生效（含关照名）、次数可配置');
{
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  // 关照名 A 也遵守降低重复率：A 在最近 3 次出现过，应被排除
  const e1 = new RollCallEngine(names);
  e1.recentDraws = [['A'], ['B'], ['A']];
  e1.attentionState['A'] = { hit: false, pos: 2 };
  const sOn = { allowRepeat: true, reduceRepeat: true, reduceRepeatCount: 3, drawCount: 1, attention: ['A'] };
  const r1 = e1.draw(sOn);
  assert(r1.selected[0] !== 'A', '关照名 A 也遵守降低重复率（最近 3 次出现过则排除）');

  // 关闭降低重复率：A 不应因去重被排除
  const e2 = new RollCallEngine(names);
  e2.recentDraws = [['A'], ['B'], ['A']];
  e2.attentionState['A'] = { hit: false, pos: 2 };
  const sOff = { allowRepeat: true, reduceRepeat: false, drawCount: 1, attention: ['A'] };
  const cands = e2._buildCandidates(sOff, { A: true }, 1);
  assert(cands.indexOf('A') >= 0, '关闭降低重复率后，A 保留在候选池');

  // 自定义次数 N=2
  const e3 = new RollCallEngine(names);
  e3.recentDraws = [['A'], ['B']]; // 最近 2 次含 A
  e3.attentionState['A'] = { hit: false, pos: 2 };
  const sN2 = { allowRepeat: true, reduceRepeat: true, reduceRepeatCount: 2, drawCount: 1, attention: ['A'] };
  const r3 = e3.draw(sN2);
  assert(r3.selected[0] !== 'A', 'N=2 时，A 在最近 2 次出现则被排除');
}

console.log('\n[9] 降低重复率：普通名字 3 次内不重复');
{
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const e = new RollCallEngine(names);
  const s = { allowRepeat: true, reduceRepeat: true, drawCount: 1, attention: [] };
  const picks = [];
  for (let i = 0; i < 10; i++) picks.push(e.draw(s).selected[0]);
  let ok = true;
  for (let i = 0; i < picks.length - 1; i++) {
    for (let j = i + 1; j < Math.min(i + 3, picks.length); j++) {
      if (picks[i] === picks[j]) { ok = false; break; }
    }
    if (!ok) break;
  }
  assert(ok, '普通名字最近 3 次内不重复');
}

console.log('\n[10] 自定义周期数生效');
{
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const e = new RollCallEngine(names);
  const s = { allowRepeat: true, reduceRepeat: false, drawCount: 1, attention: ['A'], singleCycle: 3 };
  let appeared = false;
  for (let i = 0; i < 3; i++) {
    const r = e.draw(s);
    if (r.selected[0] === 'A') { appeared = true; break; }
  }
  assert(appeared, 'singleCycle=3 时 3 次内 A 强制出现');
}

console.log('\n[11] 多个人名独立计数 + 顺延（一次只强制一个）');
{
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const e = new RollCallEngine(names);
  const s = { allowRepeat: true, reduceRepeat: false, drawCount: 3, attention: ['A', 'B'] };
  let a = false, b = false;
  for (let i = 0; i < 5; i++) {
    const r = e.draw(s);
    if (r.selected.indexOf('A') >= 0) a = true;
    if (r.selected.indexOf('B') >= 0) b = true;
  }
  assert(a && b, '多人模式 A 和 B 都在 5 次内强制出现（一个到期、另一个顺延）');
}

console.log('\n[15] 多人顺延：多个关照名同时到期一次只强制一个');
{
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const e = new RollCallEngine(names);
  // 白盒构造：A、B 都到期（cycleSize=4，pos=4）
  e.attentionState['A'] = { hit: false, pos: 4 };
  e.attentionState['B'] = { hit: false, pos: 4 };
  const s = { allowRepeat: true, reduceRepeat: false, drawCount: 3, attention: ['A', 'B'] };
  const r = e.draw(s);
  const attInResult = r.selected.filter(function (nm) { return nm === 'A' || nm === 'B'; }).length;
  assert(attInResult === 1, '本次结果只含 1 个关照名（另一个顺延）');
  const aPos = e.attentionState['A'].pos;
  const bPos = e.attentionState['B'].pos;
  if (r.selected.indexOf('A') >= 0) {
    assert(aPos === 0 && bPos === 4, 'A 被强制重置为 0，B 顺延保持 4');
  } else {
    assert(bPos === 0 && aPos === 4, 'B 被强制重置为 0，A 顺延保持 4');
  }
}

console.log('\n[12] 渐进概率：权重随周期自适应、平缓且略往后偏');
{
  const total = 18, N = 5; // 中间项 M = 3
  const e = new RollCallEngine(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  const w = (pos, hit) => e._attentionWeight({ hit: !!hit, pos: pos }, total, N);
  assert(Math.abs(w(1, false) - 2.16) < 0.001, '第 1 次权重 = 18×0.12 = 2.16（有基础概率）');
  assert(w(2, false) === 4, '第 2 次权重 = 18×2×(1/3)² = 4');
  assert(w(3, false) === 16, '第 3 次权重 = 18×2×(2/3)² = 16');
  assert(w(4, false) === 36, '第 4 次权重 = 18×2 = 36');
  assert(Math.abs(w(3, true) - 2.16) < 0.001, '命中后权重降回初始（与第 1 次相同）');
  // 多人周期 N=4, M=2
  assert(e._attentionWeight({ hit: false, pos: 3 }, total, 4) === 36, '多人第 3 次权重 = 36');
  // 自定义周期 N=7, M=4
  assert(e._attentionWeight({ hit: false, pos: 5 }, total, 7) === 36, '周期 7 第 5 次权重 = 36');
}

console.log('\n[13] 渐进概率：关照名大概率在周期中段出现（非保底）');
{
  const names = [];
  for (let i = 0; i < 30; i++) names.push('N' + i);
  names.push('A'); // A 为关照名，池子共 31 人
  const s = { allowRepeat: true, reduceRepeat: false, drawCount: 1, attention: ['A'] };
  const N = 2000;
  const posCount = [0, 0, 0, 0, 0, 0]; // 首次出现位置 1~5
  for (let t = 0; t < N; t++) {
    const e = new RollCallEngine(names);
    for (let k = 1; k <= 5; k++) {
      const r = e.draw(s);
      if (r.selected[0] === 'A') { posCount[k]++; break; }
    }
  }
  console.log('  出现位置分布: 第1次=' + posCount[1] + ' 第2次=' + posCount[2] + ' 第3次=' + posCount[3] + ' 第4次=' + posCount[4] + ' 第5次(保底)=' + posCount[5]);
  const mid = posCount[2] + posCount[3] + posCount[4];
  assert(mid > posCount[5], '周期中段（2~4 次）出现次数显著多于第 5 次保底');
  assert(posCount[3] > posCount[5], '第 3 次出现次数显著多于第 5 次保底');
  assert(posCount[4] > posCount[2], '第 4 次出现次数多于第 2 次（分布往后偏）');
}

console.log('\n[14] 不重复模式跨轮错位：上轮靠前的名字下轮靠后');
{
  const names = [];
  for (let i = 0; i < 10; i++) names.push('N' + i);
  const e = new RollCallEngine(names);
  // 构造上一轮顺序 N0..N9（前一半 N0~N4 靠前）
  e.lastRoundOrder = ['N0', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9'];
  const pool = e._nextRoundPool();
  let ok = true;
  ['N0', 'N1', 'N2', 'N3', 'N4'].forEach(function (nm) {
    if (pool.indexOf(nm) < 5) ok = false;
  });
  assert(ok, '上轮靠前的 5 个名字全部出现在新一轮池子的后半段');
  assert(pool.length === 10 && new Set(pool).size === 10, '新一轮池子包含全部 10 个名字');
}

console.log('\n结果：' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);

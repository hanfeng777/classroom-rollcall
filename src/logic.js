/* ============================================================
 * 课堂点名 · 抽取算法核心引擎（纯逻辑，可在浏览器 / Node 中运行）
 *
 * 规则实现要点：
 *  1. 不重复机制：allowRepeat=false 时，被抽中的人名移出剩余池，
 *     直到池空才自动开启新一轮。
 *  2. 降低重复率：仅在允许重复时生效（全局生效，重点关照名同样遵守），
 *     最近 reduceRepeatCount（默认 3，可配置）次出现过的名字暂时排除（池不足除外）。
 *  3. 重点关照：仅在允许重复时生效。
 *     - 渐进概率：每个关照人名独立计数，初始概率与普通人相同；周期内
 *       每次未抽中，概率按「池子人数 × (k-1)² / 2」平方加速递增，使概率
 *       峰值落在周期中段（第 3 次附近），而非每次都拖到周期末保底；
 *       周期内一旦抽中，概率强制降回初始值且本周期内不再递增。
 *     - 周期强制：单人每 singleCycle（默认5）次、多人每 multiCycle
 *       （默认4）次为一个统计周期，周期末仍未出现则 100% 强制出现；
 *       周期长度可由用户配置。
 *     - 多人强制去重：多个关照名同时到期时，一次只随机强制其中一个，
 *       其余顺延（本次不参与选择、不计入周期计数），直到后续被强制。
 *  4. 超限处理：设定人数大于总人数时按总人数执行。
 *  5. 人数不足：多人点名剩余不足时按剩余人数抽取，不自动开启下一轮。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RollCall = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COOLDOWN_DRAWS = 3; // 冷却窗口：最近 3 次点名

  function RollCallEngine(names) {
    this.names = [];
    this.setNames(names || []);
  }

  RollCallEngine.prototype.setNames = function (names) {
    this.names = Array.isArray(names) ? names.slice() : [];
    this.resetRuntime();
  };

  RollCallEngine.prototype.resetRuntime = function () {
    this.remainingPool = this._shuffle(this.names.slice()); // 不重复模式的剩余池（洗牌队列）
    this.recentDraws = []; // 最近 N 次点名结果（每次为数组）
    this.attentionState = {}; // name -> { hit, pos }
    this.history = []; // 全部抽中记录（扁平）
    this.roundOrder = []; // 当前轮已抽顺序（用于跨轮错位）
    this.lastRoundOrder = null; // 上一轮抽取顺序
  };

  // 洗牌（Fisher-Yates）
  RollCallEngine.prototype._shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  };

  // 生成新一轮的不重复池：随机洗牌 + 跨轮错位
  // 上一轮靠前的一半名字，这一轮挪到后半段，避免某些名字连续多轮靠前
  RollCallEngine.prototype._nextRoundPool = function () {
    var n = this.names.length;
    var order = this._shuffle(this.names.slice());
    if (this.lastRoundOrder && this.lastRoundOrder.length === n) {
      var half = Math.floor(n / 2);
      var frontSet = {};
      for (var i = 0; i < half; i++) frontSet[this.lastRoundOrder[i]] = true;
      var front = order.filter(function (nm) { return frontSet[nm]; });
      var rest = order.filter(function (nm) { return !frontSet[nm]; });
      order = rest.concat(front);
    }
    return order;
  };

  /**
   * 执行一次点名抽取。
   * @param {object} settings
   *   - allowRepeat : boolean   是否允许重复
   *   - reduceRepeat: boolean   是否降低重复率
   *   - drawCount   : number    一次点名人数
   *   - attention   : string[]  重点关照人名（独立计数）
   *   - singleCycle : number    单人周期（默认 5）
   *   - multiCycle  : number    多人周期（默认 4）
   * @returns {object} { selected, allPicked, n, due, cycleSize }
   */
  RollCallEngine.prototype.draw = function (settings) {
    var names = this.names;
    var total = names.length;
    if (total === 0) {
      return { selected: [], allPicked: false, n: 0, due: [], cycleSize: 0 };
    }

    var requested = Math.max(1, settings.drawCount || 1);
    var allowRepeat = !!settings.allowRepeat;

    // 有效抽取人数：不重复模式受剩余池限制；否则受总人数限制
    var n;
    if (!allowRepeat) {
      if (this.remainingPool.length === 0) {
        this.remainingPool = this._nextRoundPool();
      }
      n = Math.min(requested, this.remainingPool.length);
    } else {
      n = Math.min(requested, total);
    }

    // 重点关照仅在允许重复时生效（attention 为名字数组）
    var attList = allowRepeat
      ? (settings.attention || []).filter(function (nm) {
          return names.indexOf(nm) >= 0;
        })
      : [];

    var attSet = {};
    attList.forEach(function (nm) {
      attSet[nm] = true;
    });

    // 周期大小：单人/多人，默认 5/4，可配置
    var cycleSize = requested > 1
      ? (settings.multiCycle || 4)
      : (settings.singleCycle || 5);

    // 1) 推进周期计数，按渐进公式计算当前权重
    // 到期顺延的关照名（上轮已到期待强制但未被抽中）不递增，保持待强制
    var attWeight = {};
    attList.forEach(function (nm) {
      var st = this.attentionState[nm] || { hit: false, pos: 0 };
      var wasDue = st.pos >= cycleSize && !st.hit;
      if (!wasDue) {
        st.pos += 1;
      }
      this.attentionState[nm] = st;
      attWeight[nm] = this._attentionWeight(st, total, cycleSize);
    }, this);

    // 周期末仍未出现 → 到期，需强制
    var due = attList.filter(function (nm) {
      var st = this.attentionState[nm];
      return st.pos >= cycleSize && !st.hit;
    }, this);

    // 一次最多强制 1 个关照名（随机选），其余顺延：
    // 本次不参与选择、不计入周期计数，直到后续被强制
    var forced = [];
    var deferred = [];
    if (due.length > 0) {
      var forcedIdx = Math.floor(Math.random() * due.length);
      forced = [due[forcedIdx]];
      for (var di = 0; di < due.length; di++) {
        if (di !== forcedIdx) deferred.push(due[di]);
      }
    }

    // 2) 构建候选池（去重）
    var candidates = this._buildCandidates(settings, attSet, n);

    // 顺延的关照名本次不参与选择（保持待强制，下次继续）
    if (deferred.length > 0) {
      var defSet = {};
      deferred.forEach(function (nm) { defSet[nm] = true; });
      var withoutDef = candidates.filter(function (c) { return !defSet[c]; });
      if (withoutDef.length >= n) candidates = withoutDef;
      // 否则池不足，保留（允许顺延关照名被自然抽中，罕见情况）
    }

    // 3) 选择
    var selected = [];
    var selSet = {};
    if (!allowRepeat) {
      // 不重复模式：按洗牌队列顺序依次取（跨轮错位已体现在队列顺序上）
      for (var i = 0; i < candidates.length && selected.length < n; i++) {
        var nm = candidates[i];
        if (!selSet[nm]) {
          selected.push(nm);
          selSet[nm] = true;
        }
      }
    } else {
      // 允许重复：先放强制出现的关照人名，再用加权随机补齐
      forced.forEach(function (f) {
        if (selected.length >= n) return;
        selected.push(f);
        selSet[f] = true;
      });

      while (selected.length < n) {
        var pool = candidates.filter(function (c) {
          return !selSet[c];
        });
        var pick;
        if (pool.length > 0) {
          pick = this._weightedRandom(pool, attWeight);
        } else {
          var fallback = names.filter(function (c) {
            return !selSet[c];
          });
          if (fallback.length === 0) break;
          pick = fallback[Math.floor(Math.random() * fallback.length)];
        }
        selected.push(pick);
        selSet[pick] = true;
      }
    }

    // 4) 更新关照状态（命中标记、周期推进与顺延保持）
    attList.forEach(function (nm) {
      var st = this.attentionState[nm];
      var hitNow = selected.indexOf(nm) >= 0;
      if (st.pos >= cycleSize) {
        // 到期：本次被抽中（强制）或本周期已提前命中 → 周期结束重置；
        // 顺延（未命中且本次未抽中）→ 保持待强制
        if (hitNow || st.hit) {
          st.hit = false;
          st.pos = 0;
        }
      } else if (hitNow) {
        // 周期内提前抽中 → 本周期概率降回初始，不再递增
        st.hit = true;
      }
      this.attentionState[nm] = st;
    }, this);

    // 5) 更新历史 / 冷却窗口 / 剩余池
    selected.forEach(function (s) {
      this.history.push(s);
    }, this);
    this.recentDraws.push(selected.slice());
    var keep = Math.max(COOLDOWN_DRAWS, settings.reduceRepeat ? (settings.reduceRepeatCount || 3) : 0);
    if (this.recentDraws.length > keep) {
      this.recentDraws.splice(0, this.recentDraws.length - keep);
    }

    var allPicked = false;
    if (!allowRepeat) {
      selected.forEach(function (s) {
        var idx = this.remainingPool.indexOf(s);
        if (idx >= 0) this.remainingPool.splice(idx, 1);
        this.roundOrder.push(s);
      }, this);
      if (this.remainingPool.length === 0) {
        this.lastRoundOrder = this.roundOrder.slice();
        this.roundOrder = [];
        this.remainingPool = this._nextRoundPool();
        allPicked = true;
      }
    }

    return { selected: selected, allPicked: allPicked, n: selected.length, due: due, cycleSize: cycleSize };
  };

  // 关照名当前权重（渐进加速，随周期自适应）
  // - 基础权重 = 0.12 × 池子人数：第 1 次即有一定概率（约 11%），保证每次都有可能
  // - 之后按 (k-1)/M 的平方加速，M = ceil(周期/2) 为中间项，峰值倍数 2
  // - 概率分布略往后偏：中间项 M 与 M+1 综合最高，且 M+1 比 M-1 更大
  // - 命中后降回初始（0.12 × 池子），本周期不再递增
  RollCallEngine.prototype._attentionWeight = function (st, total, cycleSize) {
    var M = Math.ceil(cycleSize / 2); // 中间项
    var ratio = (st.pos - 1) / M;
    var mult = st.hit ? 0.12 : Math.max(0.12, 2 * ratio * ratio);
    return Math.max(1, total * mult);
  };

  // 最近 k 次点名结果中出现过的名字集合
  RollCallEngine.prototype._recentNames = function (k) {
    var result = {};
    var start = Math.max(0, this.recentDraws.length - k);
    for (var i = start; i < this.recentDraws.length; i++) {
      this.recentDraws[i].forEach(function (nm) {
        result[nm] = true;
      });
    }
    return result;
  };

  RollCallEngine.prototype._buildCandidates = function (settings, attSet, n) {
    var names = this.names;

    if (!settings.allowRepeat) {
      if (this.remainingPool.length === 0) this.remainingPool = names.slice();
      return this.remainingPool.slice();
    }

    var candidates = names.slice();

    // 显式排除名单（课时模式等场景使用），池不足除外
    if (settings.excludeNames && settings.excludeNames.length > 0) {
      var exSet = {};
      settings.excludeNames.forEach(function (nm) { exSet[nm] = true; });
      var withoutEx = candidates.filter(function (c) { return !exSet[c]; });
      if (withoutEx.length >= n) candidates = withoutEx;
      // 否则池不足，保留（允许重复）
    }

    // 降低重复率（全局生效，重点关照名同样遵守）：
    // 最近 reduceRepeatCount 次出现过的名字排除，池不足除外
    if (settings.reduceRepeat) {
      var k = settings.reduceRepeatCount || 3;
      var recentK = this._recentNames(k);
      var filtered = candidates.filter(function (c) {
        return !recentK[c];
      });
      if (filtered.length >= n) candidates = filtered;
      // 否则池不足，允许重复
    }

    return candidates;
  };

  RollCallEngine.prototype._weightedRandom = function (pool, attWeight) {
    var weights = pool.map(function (nm) {
      return attWeight[nm] || 1;
    });
    var totalWeight = 0;
    for (var i = 0; i < weights.length; i++) totalWeight += weights[i];
    var r = Math.random() * totalWeight;
    for (var j = 0; j < pool.length; j++) {
      r -= weights[j];
      if (r <= 0) return pool[j];
    }
    return pool[pool.length - 1];
  };

  return { RollCallEngine: RollCallEngine, COOLDOWN_DRAWS: COOLDOWN_DRAWS };
});

/* ============================================================
 * 课堂点名 · 界面交互逻辑
 * ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'rollcall-state-v1';
  var HALF_HOUR_MS = 30 * 60 * 1000;

  var state = {
    names: [],
    settings: {
      voiceEnabled: false,
      allowRepeat: true,
      drawCount: 1,
      reduceRepeat: false,
      reduceRepeatCount: 3 // 降低重复率次数（默认 3）
    },
    attention: [], // string[] 重点关照人名（独立计数）
    singleCycle: 5,
    multiCycle: 4,
    // 防学生
    antiStudent: false,
    antiStudentPassword: '',
    antiStudentUnlockUntil: 0,
    // 生效方式（课时模式）
    mode: 'times', // 'times' 次数模式 | 'lesson' 课时模式
    modeNoRemind: false,
    lessonNoRemind: false,
    lessonRepeatCount: 1, // 降低重复率课时数：0.5 / 1 / 2 / 3 / 4 / 5
    lessonStarted: false,
    lessonStartTime: 0,
    lessonPicked: [], // 本节课已抽中名单（课时去重）
    halfHourStart: 0, // 0.5 课时模式的半小时周期起点
    halfHourPicked: [], // 当前半小时已抽中名单
    lessonHistory: [] // 过去每节课的名单（整数课时去重）
  };

  var engine = new RollCall.RollCallEngine([]);
  var rolling = false;
  var rollTick = null;
  var rollTimer = null;

  var measureCtx = document.createElement('canvas').getContext('2d');
  var FONT_FAMILY = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Segoe UI",sans-serif';

  /* ---------------- 工具函数 ---------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function $(id) {
    return document.getElementById(id);
  }

  function fitFont(text, containerWidth, baseMax) {
    var size = baseMax;
    measureCtx.font = '800 ' + size + 'px ' + FONT_FAMILY;
    while (size > 26 && measureCtx.measureText(text).width > containerWidth * 0.92) {
      size -= 6;
      measureCtx.font = '800 ' + size + 'px ' + FONT_FAMILY;
    }
    return size;
  }

  function longestName(names) {
    var max = '';
    names.forEach(function (n) {
      if (n.length > max.length) max = n;
    });
    return max;
  }

  function fitListFont(names, containerWidth) {
    var size = Math.floor(containerWidth / Math.max(2, longestName(names).length + 2));
    return Math.max(32, Math.min(size, 96));
  }

  function shuffleArray(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /* ---------------- 持久化 ---------------- */
  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          names: state.names,
          settings: state.settings,
          attention: state.attention,
          singleCycle: state.singleCycle,
          multiCycle: state.multiCycle,
          antiStudent: state.antiStudent,
          antiStudentPassword: state.antiStudentPassword,
          antiStudentUnlockUntil: state.antiStudentUnlockUntil,
          mode: state.mode,
          modeNoRemind: state.modeNoRemind,
          lessonNoRemind: state.lessonNoRemind,
          lessonRepeatCount: state.lessonRepeatCount,
          lessonStarted: state.lessonStarted,
          lessonStartTime: state.lessonStartTime,
          lessonPicked: state.lessonPicked,
          halfHourStart: state.halfHourStart,
          halfHourPicked: state.halfHourPicked,
          lessonHistory: state.lessonHistory
        })
      );
    } catch (e) {
      /* ignore */
    }
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d.names && Array.isArray(d.names)) state.names = d.names;
      if (d.settings) {
        Object.keys(state.settings).forEach(function (k) {
          if (typeof d.settings[k] === 'boolean') state.settings[k] = d.settings[k];
          else if (typeof d.settings[k] === 'number') state.settings[k] = d.settings[k];
        });
      }
      if (d.attention && Array.isArray(d.attention)) {
        state.attention = d.attention
          .map(function (a) { return typeof a === 'string' ? a : a && a.name ? a.name : null; })
          .filter(Boolean);
      }
      if (typeof d.singleCycle === 'number') state.singleCycle = d.singleCycle;
      if (typeof d.multiCycle === 'number') state.multiCycle = d.multiCycle;
      if (typeof d.antiStudent === 'boolean') state.antiStudent = d.antiStudent;
      if (typeof d.antiStudentPassword === 'string') state.antiStudentPassword = d.antiStudentPassword;
      if (typeof d.antiStudentUnlockUntil === 'number') state.antiStudentUnlockUntil = d.antiStudentUnlockUntil;
      if (d.mode === 'lesson' || d.mode === 'times') state.mode = d.mode;
      if (typeof d.modeNoRemind === 'boolean') state.modeNoRemind = d.modeNoRemind;
      if (typeof d.lessonNoRemind === 'boolean') state.lessonNoRemind = d.lessonNoRemind;
      if (typeof d.lessonRepeatCount === 'number') state.lessonRepeatCount = d.lessonRepeatCount;
      if (typeof d.lessonStarted === 'boolean') state.lessonStarted = d.lessonStarted;
      if (typeof d.lessonStartTime === 'number') state.lessonStartTime = d.lessonStartTime;
      if (d.lessonPicked && Array.isArray(d.lessonPicked)) state.lessonPicked = d.lessonPicked;
      if (typeof d.halfHourStart === 'number') state.halfHourStart = d.halfHourStart;
      if (d.halfHourPicked && Array.isArray(d.halfHourPicked)) state.halfHourPicked = d.halfHourPicked;
      if (d.lessonHistory && Array.isArray(d.lessonHistory)) state.lessonHistory = d.lessonHistory;
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------------- 课时模式：半小时周期更新 ---------------- */
  function updateHalfHourCycle() {
    var now = Date.now();
    if (!state.halfHourStart) state.halfHourStart = now;
    var elapsed = now - state.halfHourStart;
    if (elapsed >= HALF_HOUR_MS) {
      var periods = Math.floor(elapsed / HALF_HOUR_MS);
      state.halfHourStart += periods * HALF_HOUR_MS;
      state.halfHourPicked = [];
    }
  }

  // 课时模式下的排除名单（降低重复率按课时 + 重点关照本课时去重）
  function calcLessonExclude() {
    var exclude = {};
    if (state.settings.reduceRepeat) {
      var n = state.lessonRepeatCount;
      if (n === 0.5) {
        updateHalfHourCycle();
        state.halfHourPicked.forEach(function (nm) { exclude[nm] = true; });
      } else {
        // 整数课时：最近 N 节课（含当前课）
        var past = Math.max(0, Math.floor(n) - 1);
        var hist = state.lessonHistory.slice(-past);
        hist.forEach(function (names) {
          names.forEach(function (nm) { exclude[nm] = true; });
        });
        state.lessonPicked.forEach(function (nm) { exclude[nm] = true; });
      }
    }
    // 重点关照本课时去重（课时模式，独立于降低重复率）
    if (state.attention.length > 0) {
      var pickedSet = {};
      state.lessonPicked.forEach(function (nm) { pickedSet[nm] = true; });
      state.attention.forEach(function (nm) {
        if (pickedSet[nm]) exclude[nm] = true;
      });
    }
    return Object.keys(exclude);
  }

  function currentDrawSettings() {
    var s = {
      allowRepeat: state.settings.allowRepeat,
      reduceRepeat: state.settings.reduceRepeat,
      reduceRepeatCount: state.settings.reduceRepeatCount,
      drawCount: state.settings.drawCount,
      attention: state.attention,
      singleCycle: state.singleCycle,
      multiCycle: state.multiCycle,
      excludeNames: []
    };
    if (state.mode === 'lesson') {
      s.reduceRepeat = false; // 课时模式改用 excludeNames 去重
      s.excludeNames = calcLessonExclude();
    }
    return s;
  }

  /* ---------------- 语音播报 ---------------- */
  var zhVoice = null;
  function cacheVoices() {
    if (!window.speechSynthesis) return;
    var voices = window.speechSynthesis.getVoices();
    zhVoice =
      voices.find(function (v) {
        return /zh[-_]?CN|Chinese|Huihui|Kangkang|Yaoyao|Xiaoxiao/i.test(v.name);
      }) || null;
  }
  if (window.speechSynthesis) {
    cacheVoices();
    window.speechSynthesis.onvoiceschanged = cacheVoices;
  }

  function speak(names) {
    if (!state.settings.voiceEnabled) return;
    if (!window.speechSynthesis || names.length === 0) return;
    var text = names.join('，');
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    if (zhVoice) u.voice = zhVoice;
    u.rate = 1.0;
    u.pitch = 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  /* ---------------- 视图切换 ---------------- */
  function showView(name) {
    ['main', 'settings', 'advanced'].forEach(function (v) {
      $('view-' + v).classList.toggle('active', v === name);
    });
  }

  /* ---------------- 主界面：点名 ---------------- */
  function renderIdle() {
    $('main-content').innerHTML = '<div class="idle-text">点击开始点名</div>';
  }

  function renderRollingName(name) {
    var width = Math.max(200, $('main-content').clientWidth - 60);
    var size = fitFont(name, width, 240);
    $('main-content').innerHTML =
      '<div class="roll-name" style="font-size:' + size + 'px">' + escapeHtml(name) + '</div>';
  }

  function renderResult(result) {
    var width = Math.max(200, $('main-content').clientWidth - 60);
    if (result.selected.length === 1) {
      var name = result.selected[0];
      var size = fitFont(name, width, 320);
      $('main-content').innerHTML =
        '<div class="result-single" style="font-size:' + size + 'px">' +
        escapeHtml(name) +
        '</div><div class="result-hint">点击继续点名</div>';
    } else {
      var countText = '抽中 ' + result.selected.length + ' 人';
      var cSize = fitFont(countText, width, 140);
      var html =
        '<div class="result-multi"><div class="result-count" style="font-size:' +
        cSize +
        'px">' +
        countText +
        '</div>';
      if (result.selected.length > 0) {
        var nSize = fitListFont(result.selected, width);
        html += '<div class="result-list">';
        result.selected.forEach(function (nm) {
          html += '<span class="chip" style="font-size:' + nSize + 'px">' + escapeHtml(nm) + '</span>';
        });
        html += '</div>';
      }
      html += '<div class="result-hint">点击继续点名</div></div>';
      $('main-content').innerHTML = html;
    }
  }

  function startRoll() {
    if (rolling) {
      finishRoll();
      return;
    }
    if (state.names.length === 0) {
      $('main-content').innerHTML =
        '<div class="idle-text" style="font-size:32px;color:#9aa0a8">请先在设置中导入人名数据</div>';
      return;
    }

    rolling = true;
    var displayPool = shuffleArray(state.names.slice());
    var dispIdx = 0;
    rollTick = setInterval(function () {
      renderRollingName(displayPool[dispIdx % displayPool.length]);
      dispIdx++;
    }, 55);

    rollTimer = setTimeout(finishRoll, 1500);
  }

  function finishRoll() {
    if (rollTick) {
      clearInterval(rollTick);
      rollTick = null;
    }
    if (rollTimer) {
      clearTimeout(rollTimer);
      rollTimer = null;
    }
    if (!rolling) return;
    var result = engine.draw(currentDrawSettings());
    // 课时模式：记录本课时 / 半小时抽中名单
    if (state.mode === 'lesson' && state.lessonStarted) {
      result.selected.forEach(function (nm) {
        if (state.lessonPicked.indexOf(nm) < 0) state.lessonPicked.push(nm);
        if (state.halfHourPicked.indexOf(nm) < 0) state.halfHourPicked.push(nm);
      });
    }
    renderResult(result);
    rolling = false;
    if (result.selected.length <= 5) {
      speak(result.selected);
    }
    saveState();
  }

  /* ---------------- 设置界面 ---------------- */
  function syncSettingsUI() {
    $('set-voice').checked = state.settings.voiceEnabled;
    $('set-allow-repeat').checked = state.settings.allowRepeat;
    $('set-reduce-repeat').checked = state.settings.reduceRepeat;
    $('set-reduce-repeat-count').value = state.settings.reduceRepeatCount;
    $('set-count').value = state.settings.drawCount;
    $('name-count').textContent = state.names.length;
    $('att-single-cycle').value = state.singleCycle;
    $('att-multi-cycle').value = state.multiCycle;
    $('set-anti-student').checked = state.antiStudent;
    $('lesson-repeat-count').value = String(state.lessonRepeatCount);
    $('sel-mode').value = state.mode;

    // 生效方式
    $('mode-hint').textContent = state.mode === 'lesson'
      ? '按一整节课为大周期'
      : '按次数点名（默认）';
    $('btn-new-lesson').style.display = state.mode === 'lesson' ? '' : 'none';

    // 降低重复率：小字描述随模式变化，次数行/课时行切换
    $('reduce-repeat-hint').textContent = state.mode === 'lesson'
      ? '开启后在本节课（或指定课时）内不会出现重复人名'
      : '开启后连续 N 次内不会出现重复人名';
    $('reduce-repeat-count-row').style.display = (state.settings.reduceRepeat && state.mode === 'times') ? '' : 'none';
    $('lesson-repeat-row').style.display = (state.settings.reduceRepeat && state.mode === 'lesson') ? '' : 'none';

    // 重点关照周期小字
    updateCycleHint();

    updateRepeatDependentUI();
  }

  function updateCycleHint() {
    var el = $('cycle-hint');
    if (el) {
      el.textContent = '在每轮的 ' + state.singleCycle + ' / ' + state.multiCycle + ' 次内，必定抽中';
    }
  }

  // 当「人名池允许重复」关闭时，降低重复率与重点关照不可用（变灰）
  function updateRepeatDependentUI() {
    var repeatOn = state.settings.allowRepeat;
    var rr = $('set-reduce-repeat');
    rr.disabled = !repeatOn;
    var rrRow = rr.closest('.setting-row');
    if (rrRow) rrRow.classList.toggle('disabled', !repeatOn);
    $('btn-advanced').disabled = !repeatOn;
  }

  function setMessage(text, type) {
    var el = $('import-msg');
    el.textContent = text || '';
    el.className = 'msg ' + (type || '');
  }

  function onImportFiles() {
    if (!window.api) return;
    window.api.selectFiles().then(function (paths) {
      if (paths && paths.length) {
        readFiles(paths);
      }
    });
  }

  function readFiles(paths) {
    setMessage('正在读取…', '');
    window.api.readFiles(paths).then(function (res) {
      if (res.ok) {
        setMessage('检测到 ' + res.names.length + ' 个人名（来自 ' + res.fileCount + ' 个文件），点击「确定」生效', 'ok');
        $('name-count').textContent = res.names.length;
        $('name-count').dataset.pending = res.names.join('\u0001');
      } else {
        setMessage('未检测到有效人名数据，请检查文件后重试', 'err');
      }
    });
  }

  function onConfirm() {
    var pending = $('name-count').dataset.pending;
    if (!pending) {
      setMessage('请先导入表格文件', 'err');
      return;
    }
    var newNames = pending.split('\u0001').filter(function (n) {
      return n && n.trim().length > 0;
    });
    if (newNames.length === 0) {
      setMessage('未检测到有效人名数据，请检查文件后重试', 'err');
      return;
    }
    var same = arraysEqual(state.names, newNames);
    state.names = newNames;
    if (!same) {
      state.attention = [];
    }
    engine = new RollCall.RollCallEngine(state.names);
    delete $('name-count').dataset.pending;
    setMessage('已导入 ' + state.names.length + ' 个人名', 'ok');
    saveState();
    syncSettingsUI();
    renderIdle();
  }

  function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /* ---------------- 拖拽导入 ---------------- */
  function bindDropZone() {
    var dz = $('drop-zone');
    dz.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.add('dragover');
    });
    dz.addEventListener('dragleave', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove('dragover');
    });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove('dragover');
      var files = Array.prototype.slice.call(e.dataTransfer.files || []);
      if (files.length === 0) return;
      var paths = files
        .map(function (f) {
          return window.api && window.api.getPathForFile ? window.api.getPathForFile(f) : null;
        })
        .filter(Boolean);
      if (paths.length === 0) {
        setMessage('无法读取拖入的文件，请改用「导入表格文件」', 'err');
        return;
      }
      readFiles(paths);
    });
  }

  /* ---------------- 名单管理弹层 ---------------- */
  var manageFilter = '';
  function openManage() {
    $('manage-search').value = '';
    manageFilter = '';
    $('modal-manage').classList.add('show');
    renderManageList();
  }
  function closeManage() {
    $('modal-manage').classList.remove('show');
    saveState();
    syncSettingsUI();
  }

  function renderManageList() {
    var list = state.names.filter(function (n) {
      return !manageFilter || n.indexOf(manageFilter) >= 0;
    });
    var html = '';
    list.forEach(function (n, i) {
      var realIdx = state.names.indexOf(n);
      html +=
        '<div class="manage-item">' +
        '<span class="idx">' + (realIdx + 1) + '</span>' +
        '<input class="name-input" data-name="' + escapeHtml(n) + '" value="' + escapeHtml(n) + '" />' +
        '<button class="del" data-del="' + escapeHtml(n) + '" title="删除">×</button>' +
        '</div>';
    });
    if (html === '') html = '<div class="att-empty">没有匹配的人名</div>';
    $('manage-list').innerHTML = html;

    Array.prototype.forEach.call($('manage-list').querySelectorAll('.name-input'), function (input) {
      input.addEventListener('change', function () {
        var old = input.dataset.name;
        var val = input.value.trim();
        var idx = state.names.indexOf(old);
        if (idx >= 0) {
          if (val === '') {
            state.names.splice(idx, 1);
          } else {
            state.names[idx] = val;
          }
          engine = new RollCall.RollCallEngine(state.names);
          renderManageList();
        }
      });
    });

    Array.prototype.forEach.call($('manage-list').querySelectorAll('.del'), function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.dataset.del;
        var idx = state.names.indexOf(name);
        if (idx >= 0) state.names.splice(idx, 1);
        engine = new RollCall.RollCallEngine(state.names);
        renderManageList();
      });
    });
  }

  /* ---------------- 高级设置：重点关照 ---------------- */
  function currentCycleSize() {
    return state.settings.drawCount > 1 ? state.multiCycle : state.singleCycle;
  }

  function renderAttention() {
    var cycleSize = currentCycleSize();
    var modeText = state.settings.drawCount > 1 ? '多人' : '单人';
    var hintEl = $('att-cycle-hint');
    if (hintEl) {
      hintEl.textContent = '当前：' + modeText + '周期 ' + cycleSize + ' 次';
    }
    updateCycleHint();
    var html = '';
    if (state.attention.length === 0) {
      html = '<div class="att-empty">尚未设置重点关照人名</div>';
    } else {
      state.attention.forEach(function (nm) {
        var st = engine.attentionState[nm];
        var pos = st ? st.pos : 0;
        var showPos = Math.max(1, pos);
        html +=
          '<div class="att-item">' +
          '<span class="att-name">' + escapeHtml(nm) + '</span>' +
          '<span class="att-progress">第 ' + showPos + '/' + cycleSize + ' 次</span>' +
          '<button class="att-del" data-del="' + escapeHtml(nm) + '" title="移除">×</button>' +
          '</div>';
      });
    }
    $('att-list').innerHTML = html;

    Array.prototype.forEach.call($('att-list').querySelectorAll('.att-del'), function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.dataset.del;
        requireAntiStudent(function () {
          state.attention = state.attention.filter(function (n) {
            return n !== name;
          });
          saveState();
          renderAttention();
          renderCandidates();
        });
      });
    });
  }

  function renderCandidates() {
    var kw = ($('att-search').value || '').trim();
    var attSet = {};
    state.attention.forEach(function (n) {
      attSet[n] = true;
    });
    var candidates = state.names.filter(function (n) {
      return !attSet[n] && (!kw || n.indexOf(kw) >= 0);
    });
    var html = '';
    candidates.slice(0, 200).forEach(function (n) {
      html += '<span class="cand" data-name="' + escapeHtml(n) + '">' + escapeHtml(n) + '</span>';
    });
    if (html === '') html = '<div class="att-empty" style="width:100%">无可添加的人名</div>';
    $('att-candidates').innerHTML = html;

    Array.prototype.forEach.call($('att-candidates').querySelectorAll('.cand'), function (el) {
      el.addEventListener('click', function () {
        addAttention(el.dataset.name);
      });
    });
  }

  function addAttention(name) {
    if (!name) return;
    requireAntiStudent(function () {
      if (state.attention.indexOf(name) >= 0) return;
      state.attention.push(name);
      saveState();
      renderAttention();
      renderCandidates();
    });
  }

  /* ---------------- 防学生 ---------------- */
  var pwMode = 'set'; // 'set' 设置密码 | 'verify' 验证密码
  var pwCallback = null;

  function isAntiStudentUnlocked() {
    return Date.now() < state.antiStudentUnlockUntil;
  }

  function requireAntiStudent(callback) {
    if (!state.antiStudent || isAntiStudentUnlocked()) {
      callback();
      return;
    }
    openPasswordVerify(callback);
  }

  function openPasswordSet() {
    pwMode = 'set';
    pwCallback = null;
    $('pw-title').textContent = '设置密码';
    $('pw-desc').textContent = '请设置防学生密码（开启后修改重点关照或关闭本功能需验证）';
    $('pw-input').value = '';
    $('pw-msg').textContent = '';
    $('pw-msg').className = 'msg';
    $('modal-password').classList.add('show');
    $('pw-input').focus();
  }

  function openPasswordVerify(callback) {
    pwMode = 'verify';
    pwCallback = callback;
    $('pw-title').textContent = '验证密码';
    $('pw-desc').textContent = '请输入密码以继续操作';
    $('pw-input').value = '';
    $('pw-msg').textContent = '';
    $('pw-msg').className = 'msg';
    $('modal-password').classList.add('show');
    $('pw-input').focus();
  }

  function closePassword() {
    $('modal-password').classList.remove('show');
    pwCallback = null;
  }

  function confirmPassword() {
    var val = $('pw-input').value;
    if (!val) {
      $('pw-msg').textContent = '请输入密码';
      $('pw-msg').className = 'msg err';
      return;
    }
    if (pwMode === 'set') {
      state.antiStudentPassword = val;
      state.antiStudent = true;
      state.antiStudentUnlockUntil = 0; // 设置密码不自动解锁，需验证后才生效
      saveState();
      closePassword();
      syncSettingsUI();
    } else {
      if (val === state.antiStudentPassword) {
        state.antiStudentUnlockUntil = Date.now() + HALF_HOUR_MS;
        saveState();
        closePassword();
        var cb = pwCallback;
        pwCallback = null;
        if (cb) cb();
      } else {
        $('pw-msg').textContent = '密码错误，请重试';
        $('pw-msg').className = 'msg err';
      }
    }
  }

  /* ---------------- 课时模式 ---------------- */
  function doStartNewLesson() {
    state.lessonHistory.push(state.lessonPicked.slice());
    if (state.lessonHistory.length > 5) state.lessonHistory.shift();
    state.lessonPicked = [];
    state.lessonStarted = true;
    state.lessonStartTime = Date.now();
    state.halfHourStart = Date.now();
    state.halfHourPicked = [];
    saveState();
    renderIdle();
  }

  function openLessonConfirm(allowNoRemind) {
    var row = $('lesson-no-remind-row');
    if (row) row.style.display = allowNoRemind ? '' : 'none';
    $('modal-lesson').classList.add('show');
  }

  function confirmLesson() {
    var row = $('lesson-no-remind-row');
    if (row && row.style.display !== 'none') {
      state.lessonNoRemind = $('lesson-no-remind').checked;
    }
    $('modal-lesson').classList.remove('show');
    doStartNewLesson();
  }

  var pendingMode = null;

  function openModeSwitch(target) {
    pendingMode = target;
    $('mode-title').textContent = '切换到' + (target === 'lesson' ? '课时模式' : '次数模式');
    $('mode-desc').textContent = target === 'lesson'
      ? '课时模式：按一整节课为一个大周期。开启后每次打开软件会提示开启新一堂课；也可在主界面右下角「＋」图标随时开启新一堂课。降低重复率改为按课时计数，重点关照在本课时内点到后本课时不再重复。'
      : '次数模式：默认模式，按每次点名计数。降低重复率按次数、重点关照按次数周期。';
    $('mode-no-remind').checked = state.modeNoRemind;
    $('modal-mode').classList.add('show');
  }

  function confirmModeSwitch() {
    state.modeNoRemind = $('mode-no-remind').checked;
    $('modal-mode').classList.remove('show');
    doSwitchMode(pendingMode);
  }

  function doSwitchMode(target) {
    if (!target) return;
    state.mode = target;
    if (target === 'lesson' && !state.lessonStarted) {
      state.lessonStarted = true;
      state.lessonStartTime = Date.now();
      state.halfHourStart = Date.now();
      state.lessonPicked = [];
      state.halfHourPicked = [];
      state.lessonHistory = [];
    }
    saveState();
    syncSettingsUI();
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    // 主界面
    $('main-stage').addEventListener('click', startRoll);
    $('btn-settings').addEventListener('click', function (e) {
      e.stopPropagation();
      showView('settings');
      syncSettingsUI();
    });
    $('btn-new-lesson').addEventListener('click', function (e) {
      e.stopPropagation();
      if (state.lessonNoRemind) {
        doStartNewLesson();
      } else {
        openLessonConfirm(true);
      }
    });

    // 设置界面
    $('btn-back-main').addEventListener('click', function () {
      showView('main');
      renderIdle();
    });
    $('btn-import').addEventListener('click', onImportFiles);
    $('btn-confirm').addEventListener('click', onConfirm);
    $('btn-manage').addEventListener('click', openManage);
    $('btn-advanced').addEventListener('click', function () {
      showView('advanced');
      renderCandidates();
      renderAttention();
    });
    $('btn-tutorial').addEventListener('click', function () {
      $('modal-tutorial').classList.add('show');
    });
    bindDropZone();

    // 基础设置
    $('sel-mode').addEventListener('change', function () {
      var target = this.value;
      if (target === state.mode) return;
      this.value = state.mode; // 先恢复原值，确认后再切换
      if (state.modeNoRemind) {
        doSwitchMode(target);
      } else {
        openModeSwitch(target);
      }
    });
    $('set-voice').addEventListener('change', function () {
      state.settings.voiceEnabled = this.checked;
      saveState();
    });
    $('set-allow-repeat').addEventListener('change', function () {
      state.settings.allowRepeat = this.checked;
      if (!this.checked) {
        engine = new RollCall.RollCallEngine(state.names);
      }
      updateRepeatDependentUI();
      saveState();
    });
    $('set-reduce-repeat').addEventListener('change', function () {
      state.settings.reduceRepeat = this.checked;
      $('reduce-repeat-count-row').style.display = (this.checked && state.mode === 'times') ? '' : 'none';
      $('lesson-repeat-row').style.display = (this.checked && state.mode === 'lesson') ? '' : 'none';
      saveState();
    });
    $('set-reduce-repeat-count').addEventListener('change', function () {
      var v = parseInt(this.value, 10);
      if (!isNaN(v) && v >= 1) {
        state.settings.reduceRepeatCount = Math.min(v, 50);
      }
      this.value = state.settings.reduceRepeatCount;
      saveState();
    });
    $('set-anti-student').addEventListener('change', function () {
      if (this.checked) {
        this.checked = false; // 待设置密码成功后再勾选
        openPasswordSet();
      } else {
        // 需验证密码：先恢复开关为勾选状态，验证通过后再真正关闭，
        // 避免浏览器在 change 事件里已翻转开关导致"未输密码就已关闭"的假象
        this.checked = true;
        requireAntiStudent(function () {
          state.antiStudent = false;
          state.antiStudentPassword = '';
          saveState();
          syncSettingsUI();
        });
      }
    });
    $('lesson-repeat-count').addEventListener('change', function () {
      state.lessonRepeatCount = parseFloat(this.value);
      saveState();
    });
    $('set-count').addEventListener('change', function () {
      var v = parseInt(this.value, 10);
      if (!isNaN(v) && v >= 1) {
        state.settings.drawCount = Math.min(v, 1000);
      }
      this.value = state.settings.drawCount;
      saveState();
    });
    $('count-minus').addEventListener('click', function () {
      state.settings.drawCount = Math.max(1, state.settings.drawCount - 1);
      $('set-count').value = state.settings.drawCount;
      saveState();
    });
    $('count-plus').addEventListener('click', function () {
      state.settings.drawCount = Math.min(1000, state.settings.drawCount + 1);
      $('set-count').value = state.settings.drawCount;
      saveState();
    });

    // 高级设置
    $('btn-back-settings').addEventListener('click', function () {
      showView('settings');
      syncSettingsUI();
    });
    $('att-single-cycle').addEventListener('change', function () {
      var input = this;
      requireAntiStudent(function () {
        var v = parseInt(input.value, 10);
        if (!isNaN(v) && v >= 1) {
          state.singleCycle = Math.min(v, 100);
        }
        input.value = state.singleCycle;
        updateCycleHint();
        saveState();
      });
    });
    $('att-multi-cycle').addEventListener('change', function () {
      var input = this;
      requireAntiStudent(function () {
        var v = parseInt(input.value, 10);
        if (!isNaN(v) && v >= 1) {
          state.multiCycle = Math.min(v, 100);
        }
        input.value = state.multiCycle;
        updateCycleHint();
        saveState();
      });
    });
    $('att-search').addEventListener('input', renderCandidates);
    $('att-add').addEventListener('click', function () {
      var kw = ($('att-search').value || '').trim();
      if (!kw) return;
      var match = state.names.filter(function (n) {
        return n === kw || n.indexOf(kw) === 0;
      })[0];
      addAttention(match || kw);
      $('att-search').value = '';
      renderCandidates();
    });

    // 密码弹层
    $('pw-close').addEventListener('click', closePassword);
    $('pw-cancel').addEventListener('click', closePassword);
    $('pw-confirm').addEventListener('click', confirmPassword);
    $('pw-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') confirmPassword();
    });

    // 模式切换弹层
    $('mode-close').addEventListener('click', function () { $('modal-mode').classList.remove('show'); });
    $('mode-cancel').addEventListener('click', function () { $('modal-mode').classList.remove('show'); });
    $('mode-confirm').addEventListener('click', confirmModeSwitch);

    // 新课时弹层
    $('lesson-close').addEventListener('click', function () { $('modal-lesson').classList.remove('show'); });
    $('lesson-cancel').addEventListener('click', function () { $('modal-lesson').classList.remove('show'); });
    $('lesson-confirm').addEventListener('click', confirmLesson);

    // 教程弹层
    $('tutorial-close').addEventListener('click', function () { $('modal-tutorial').classList.remove('show'); });
    $('tutorial-done').addEventListener('click', function () { $('modal-tutorial').classList.remove('show'); });

    // 名单管理弹层
    $('modal-close').addEventListener('click', closeManage);
    $('modal-done').addEventListener('click', closeManage);
    $('manage-search').addEventListener('input', function () {
      manageFilter = this.value.trim();
      renderManageList();
    });
    $('manage-add').addEventListener('click', function () {
      state.names.push('新名字');
      engine = new RollCall.RollCallEngine(state.names);
      renderManageList();
    });
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) { e.preventDefault(); });

    loadState();
    engine = new RollCall.RollCallEngine(state.names);
    bindEvents();
    syncSettingsUI();
    renderIdle();

    // 课时模式：打开软件时总是提示开启新一堂课（无"不再提醒"）
    if (state.mode === 'lesson') {
      openLessonConfirm(false);
    }
  }

  init();
})();

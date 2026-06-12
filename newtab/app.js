/* ============================================
   微信书摘 · 新标签页 — App Logic
   ============================================ */

// ---- Storage helpers ----
const STORAGE_KEY = 'wx_notes';
const SETTINGS_KEY = 'wx_settings';
const MODE_KEY = 'wx_display_mode';
const CACHE_KEY = 'wx_ai_cache';
const SOURCE_ENABLED_KEY = 'wx_source_enabled';

// 通用带错误处理的 storage 工具
function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, result => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    });
  });
}

function storageSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

async function loadAll() {
  return storageGet([STORAGE_KEY, SETTINGS_KEY]);
}

async function saveNotes(notes) {
  return storageSet({ [STORAGE_KEY]: notes });
}

// ---- DOM refs ----
const states = {
  loading:    document.getElementById('state-loading'),
  display:    document.getElementById('state-display'),
  empty:      document.getElementById('state-empty'),
  filtered:   document.getElementById('state-empty-filtered'),
};

const noteContent  = document.getElementById('noteContent');
const noteSource   = document.getElementById('noteSource');
const footerInfo   = document.getElementById('footerInfo');
const card         = document.getElementById('card');

const btnCopy      = document.getElementById('btnCopy');
const btnNext      = document.getElementById('btnNext');
const btnPrev      = document.getElementById('btnPrev');
const btnDelete    = document.getElementById('btnDelete');
const toast        = document.getElementById('toast');

// ---- State ----
let allNotes = [];
let filteredNotes = [];
let _filteredBySource = []; // 按书过滤前的笔记（供进度条面板用）
let shownIds = [];
let noteHistory = [];  // 浏览历史（上一条用）
let docKnowledgeList = [];  // 当前文档的知识点列表
let docKIndex = 0;         // 当前在第几个知识点
let currentNote = null;
let excludeBooks = [];
let excludeDocs = [];
let stats = { total: 0, excluded: 0 };
let currentMode = 'browse';
let aiCache = [];
let cacheIndex = 0;
let _currentCacheIdx = -1;
let sourceEnabled = {};
let selectedBook = null;
let pendingSeenIds = new Set();
let seenFlushTimer = null;
let _coverageExpanded = false;

// 重新触发元素的 CSS animation
function restartAnimation(el) {
  el.style.animation = 'none';
  void el.offsetHeight; // force reflow
  el.style.animation = '';
}

// 检查笔记来源是否在已启用的数据源中
function isSourceEnabled(srcType, enabledSources) {
  if (!enabledSources || enabledSources.length === 0) return true;
  return enabledSources.some(function(s) {
    if (s === 'weread' && srcType === 'weread') return true;
    if (s.startsWith('md_') && srcType === 'markdown') return true;
    return false;
  });
}

// ---- Show/hide states ----
function showState(name) {
  document.querySelectorAll('.state').forEach(function(s) { s.classList.remove('active'); });
  var el = states[name];
  if (el) el.classList.add('active');
}

// ---- Toast ----
let toastTimer = null;
function showToast(msg, duration = 2000) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ---- Build filtered list ----
function updateFiltered() {
  var candidates = allNotes;
  var srcKeys = Object.keys(sourceEnabled);

  // Apply source filter only if we have source data AND at least one source enabled
  if (srcKeys.length > 0) {
    var enabledSources = srcKeys.filter(function(k) { return sourceEnabled[k]; });
    if (enabledSources.length > 0) {
      candidates = allNotes.filter(function(n) {
        return isSourceEnabled(n.source || 'weread', enabledSources);
      });
      if (candidates.length === 0 && allNotes.length > 0) {
        // Notes exist but none match enabled sources — don't show all-off
        // This happens when sourceEnabled only tracks a subset of actual notes
        candidates = allNotes;
      }
    }
    // If no sources enabled, don't filter by source — just fall through
  }

  if (excludeBooks.length) {
    var excludeSet = new Set(excludeBooks.map(function(b) { return b.toLowerCase().trim(); }));
    candidates = candidates.filter(function(n) { return !excludeSet.has((n.book || '').toLowerCase().trim()); });
  }

  if (excludeDocs && excludeDocs.length) {
    var docSet = new Set(excludeDocs);
    candidates = candidates.filter(function(n) { return !(n.source === 'markdown' && docSet.has(n.filePath)); });
  }

  filteredNotes = candidates;

  // 保存按书过滤前的笔记列表（供进度条面板的书单用）
  _filteredBySource = candidates;

  // 按选中的书籍进一步过滤
  applyBookFilter();

  // Show all-off state only when there are truly no notes after all filtering
  if (filteredNotes.length === 0 && allNotes.length > 0) {
    if (typeof showAllOffState === 'function') showAllOffState();
  }
}

// ---- Pick next note (avoid repeats) ----
function pickNext() {
  if (!filteredNotes.length) return null;

  if (shownIds.length >= filteredNotes.length) {
    shownIds = [];
  }

  const seen = new Set(shownIds);
  const candidates = filteredNotes.filter(n => !seen.has(n.id));

  if (!candidates.length) {
    shownIds = [];
    return pickNext();
  }

  const idx = Math.floor(Math.random() * candidates.length);
  const note = candidates[idx];
  shownIds.push(note.id);
  return note;
}

// ---- Simple Markdown to HTML ----
function renderMarkdown(text) {
  if (!text) return '';
  // Escape HTML first
  var div = document.createElement('div');
  div.textContent = text;
  var html = div.innerHTML;

  // Code blocks (``` ```)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  // Blockquotes
  html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  // Headings (##, ###)
  html = html.replace(/^###\s+(.*)$/gm, '<h4>$1</h4>');
  html = html.replace(/^##\s+(.*)$/gm, '<h3>$1</h3>');
  // Unordered lists
  html = html.replace(/^[-*]\s+(.*)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  // Paragraphs (double newline)
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  // Clean up empty paragraphs and nested <p> inside block elements
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p><(ul|ol|blockquote|pre|h[34])>/g, '<$1>');
  html = html.replace(/<\/(ul|ol|blockquote|pre|h[34])><\/p>/g, '</$1>');
  // Line breaks within paragraphs
  html = html.replace(/\n/g, '<br>');
  // Clean double <br>
  html = html.replace(/(<br>){2,}/g, '<br><br>');

  return html;
}

// ---- 提取纯任务文本 ----
function cleanTaskText(text) {
  text = text.replace(/^\s*[-*]\s*\[[ x]\]\s*/, '');
  text = text.replace(/^>\s*\[!.*\].*/gm, '');
  text = text.replace(/^>\s*/gm, '');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/==/g, '');
  return text.trim();
}

// ---- 切分文档为知识点 ----
function splitDocToKnowledge(note) {
  var lines = (note.content || '').split('\n');
  var items = [], cur = [];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].match(/^\s*[-*]\s*\[[ x]\]/)) {
      if (cur.length) { items.push(cur.join('\n')); cur = []; }
      cur.push(lines[i]);
    } else if (!lines[i].match(/^\s*>?\s*\[!.*\]/)) {
      if (lines[i].trim()) cur.push(lines[i]);
    }
  }
  if (cur.length) items.push(cur.join('\n'));
  if (!items.length) {
    items = (note.content || '').split(/\n\n+/).filter(function(p) { return p.trim().length > 10; });
  }
  return items.map(cleanTaskText).filter(Boolean);
}

// ---- 显示知识点的第 N 条 ----
function showKPoint(idx, total) {
  var text = docKnowledgeList[idx] || '(无内容)';
  if (text.length > 500) text = text.slice(0, 500) + '……';
  noteContent.textContent = text;
  noteContent.classList.add('plain');
  var info = '第 ' + (idx + 1) + ' 条 / 共 ' + total + ' 条知识点';
  if (currentNote && currentNote.book) {
    noteSource.innerHTML = '<div class="book-name">📖 ' + currentNote.book + '</div><div class="book-meta" style="margin-top:2px;font-size:11px;color:var(--text-tertiary);">' + info + '</div>';
  } else {
    noteSource.innerHTML = '<div class="book-meta" style="font-size:11px;color:var(--text-tertiary);">' + info + '</div>';
  }
  showState('display');
}

// ---- Render note ----
function renderNote(note) {
  currentNote = note;

  // 对 MD 笔记按知识点切分
  if (note.source === 'markdown') {
    var items = splitDocToKnowledge(note);
    if (items.length > 1) {
      docKnowledgeList = items;
      docKIndex = 0;
      showKPoint(0, items.length);
      return;
    }
  }

  // WeChat 笔记（或单条 MD）
  docKnowledgeList = [];
  var content = note.content || '(无内容)';
  if (note.source !== 'markdown' && content.length > 500) {
    content = content.slice(0, 500) + '……';
  }
  if (note.source === 'markdown') {
    noteContent.innerHTML = renderMarkdown(cleanTaskText(content));
    noteContent.classList.remove('plain');
  } else {
    noteContent.textContent = content;
    noteContent.classList.add('plain');
  }

  if (note.book) {
    const chapterHTML = note.chapter
      ? ' &middot; ' + escapeHTML(note.chapter)
      : '';
    noteSource.innerHTML = `
      <div class="book-name">&laquo;${escapeHTML(note.book)}&raquo;</div>
      <div class="book-meta">${escapeHTML(note.author || '')}${chapterHTML}</div>
    `;
  } else {
    noteSource.innerHTML = '';
  }

  const activeCount = filteredNotes.length;
  const totalCount  = allNotes.length;
  let info = '共 ' + totalCount + ' 条笔记';
  if (stats.excluded > 0) {
    info += ' &middot; 已排除 ' + stats.excluded + ' 条';
  }
  footerInfo.innerHTML = info;

  // 标记为已接触
  if (currentNote && currentNote.id) {
    markNoteAsSeen(currentNote.id);
  }
}

function escapeHTML(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- 动画切换卡片 ----
function animateCardTransition(note, direction) {
  card.classList.remove('card-enter');
  if (direction === 'prev') {
    card.classList.add('card-exit-prev');
  } else {
    card.classList.add('card-exit');
  }

  setTimeout(() => {
    renderNote(note);
    card.classList.remove('card-exit', 'card-exit-prev');
    void card.offsetWidth;
    card.classList.add('card-enter');
    // 更新上下一条按钮状态
    updateNavButtons();
  }, 250);
}

// ---- 下一条 ----
function switchToNext() {
  // 同一文档内还有知识点，先展示下一条
  if (docKnowledgeList.length > 0 && docKIndex < docKnowledgeList.length - 1) {
    docKIndex++;
    showKPoint(docKIndex, docKnowledgeList.length);
    return;
  }

  // 把当前笔记压入历史栈
  if (currentNote) {
    noteHistory.push(currentNote);
  }
  addBrowseLog('browse', '翻页');

  const next = pickNext();
  if (!next) {
    addBrowseLog('browse', '翻页无下一节点', { filteredCount: filteredNotes.length, allCount: allNotes.length });
    // 强制显示笔记卡片（即使 filteredNotes 为空）
    showState('display');
    if (allNotes.length > 0) {
      // 有笔记但被过滤了，显示第一条
      currentNote = allNotes[0];
      noteContent.textContent = currentNote.content ? (currentNote.content.slice(0, 500) + '……') : '(无内容)';
      noteContent.classList.add('plain');
      if (currentNote.book) {
        noteSource.innerHTML = '<div class="book-name">《' + currentNote.book + '》</div>';
      } else {
        noteSource.innerHTML = '';
      }
    } else {
      noteContent.textContent = '还没有笔记，请先导入。';
      noteSource.innerHTML = '';
    }
    currentNote = null;
    return;
  }

  animateCardTransition(next, 'next');
}

// ---- 上一条 ----
function switchToPrev() {
  // 同一文档内回退到上一条知识点
  if (docKnowledgeList.length > 0 && docKIndex > 0) {
    docKIndex--;
    showKPoint(docKIndex, docKnowledgeList.length);
    return;
  }

  if (noteHistory.length === 0) return;

  if (currentNote) {
    shownIds = shownIds.filter(id => id !== currentNote.id);
  }

  const prev = noteHistory.pop();
  if (prev) {
    animateCardTransition(prev, 'prev');
  }
}

// ---- 更新按钮状态 ----
function updateNavButtons() {
  if (btnPrev) {
    btnPrev.disabled = noteHistory.length === 0;
    btnPrev.style.opacity = noteHistory.length === 0 ? '0.35' : '1';
    btnPrev.style.pointerEvents = noteHistory.length === 0 ? 'none' : 'auto';
  }
}

// ---- Mode Switching ----
function initModeSwitch() {
  var sel = document.getElementById('modeSelect');
  if (!sel) return;
  sel.addEventListener('change', function() {
    var oldMode = currentMode;
    currentMode = sel.value;
    storageSet({ [MODE_KEY]: currentMode }).catch(function() {});
    addBrowseLog('mode', '切至 ' + currentMode, { prevMode: oldMode });
    shownIds = [];
    noteHistory = [];
    loadNextInMode();
  });
}

// 当前日志序号，用于关联操作链
var _logSeq = 0;
function addBrowseLog(type, detail, extra) {
  // 取当前状态快照
  var snapshot = {
    mode: currentMode,
    selectedBook: selectedBook,
    totalNotes: allNotes.length,
    filteredCount: filteredNotes.length,
    shownIdsCount: shownIds.length,
    historyLen: noteHistory.length,
    cacheLen: aiCache.length,
    cacheIdx: cacheIndex,
    currentCacheIdx: _currentCacheIdx,
    pendingSeen: pendingSeenIds.size,
    excludeBooks: excludeBooks.length,
    excludeDocs: excludeDocs.length
  };
  if (currentNote) {
    snapshot.noteId = currentNote.id && currentNote.id.slice(0, 20);
    snapshot.noteBook = currentNote.book;
    snapshot.noteSrc = currentNote.source;
  }
  var entry = {
    seq: ++_logSeq,
    ts: new Date().toISOString(),
    type: type,
    status: 'ok',
    snapshot: snapshot
  };
  if (detail) entry.detail = detail;
  if (extra) Object.assign(entry, extra);

  // 同时输出到控制台，CDP 可直接抓取
  var logLine = '[' + entry.ts.slice(11, 23) + '][' + type + '] ' + (detail || '');
  if (extra && extra.error) logLine += ' ERROR:' + extra.error;
  console.log(logLine);

  storageGet('wx_ai_log').then(function(r) {
    var logs = r.wx_ai_log || [];
    logs.push(entry);
    if (logs.length > 1000) logs.splice(0, logs.length - 1000);
    storageSet({ wx_ai_log: logs }).catch(function() {});
  }).catch(function() {});
}

function loadPrevInMode() {
  if (aiCache.length > 0) {
    if (typeof cacheIndex !== 'number') cacheIndex = 0;
    // 从当前位置往前找匹配类型的条目
    var startIdx = (cacheIndex - 1 + aiCache.length) % aiCache.length;
    for (var tries = 0; tries < aiCache.length; tries++) {
      var idx = (startIdx - tries + aiCache.length) % aiCache.length;
      var item = aiCache[idx];
      // 跳过已关闭数据源的条目
      var srcKeys = Object.keys(sourceEnabled);
      if (srcKeys.length > 0) {
        var enabledSrcs = srcKeys.filter(function(k) { return sourceEnabled[k]; });
        if (enabledSrcs.length > 0) {
          if (!isSourceEnabled(item.srcType || 'weread', enabledSrcs)) continue;
        }
      }
      // 跳过不匹配选中书籍的条目
      if (selectedBook !== null) {
        var itemSource = item.data ? item.data.source : null;
        if (itemSource !== selectedBook) continue;
      }
      if ((currentMode === 'qa' && item.type === 'qa') || (currentMode === 'choice' && item.type === 'choice')) {
        _currentCacheIdx = idx;
        cacheIndex = idx;
        saveCacheIndex();
        if (currentMode === 'qa') renderQAMode(item.data, onAnswerResult);
        else renderChoiceMode(item.data, onAnswerResult);
        return;
      }
    }
  }
  // 没找到就回退到下一条
  loadNextInMode(true);
}

function loadNextInMode(skipCurrent) {
  // 浏览模式：先立即显示 display 状态，再异步切换到笔记内容
  if (currentMode === 'browse') {
    showState('display');
    if (currentNote) {
      noteContent.textContent = currentNote.content ? ('' + currentNote.content).slice(0, 500) + '……' : '(无内容)';
      noteContent.classList.add('plain');
      noteSource.innerHTML = currentNote.book ? '<div class="book-name">' + currentNote.book + '</div>' : '';
    }
    switchToNext();
    return;
  }

  // QA/Choice 模式读 AI 缓存
  if (skipCurrent && _currentCacheIdx >= 0 && aiCache.length > 0) {
    cacheIndex = (_currentCacheIdx + 1) % aiCache.length;
    saveCacheIndex(); // fire-and-forget: 函数非 async，无法 await
  }
  if (aiCache.length > 0) {
    if (typeof cacheIndex !== 'number') cacheIndex = 0;
    if (cacheIndex >= aiCache.length) cacheIndex = 0;
    var startIdx = cacheIndex;
    for (var tries = 0; tries < aiCache.length; tries++) {
      var idx = (startIdx + tries) % aiCache.length;
      var item = aiCache[idx];
      // 跳过已关闭数据源的条目（基于缓存中的 srcType）
      var srcKeys = Object.keys(sourceEnabled);
      if (srcKeys.length > 0) {
        var enabledSrcs = srcKeys.filter(function(k) { return sourceEnabled[k]; });
        if (enabledSrcs.length > 0) {
          var itemSrcType = item.srcType || 'weread';
          if (!isSourceEnabled(item.srcType || 'weread', enabledSrcs)) continue; // 跳过不匹配来源的条目
        }
      }
      // 跳过不匹配选中书籍的条目
      if (selectedBook !== null) {
        var itemSource = item.data ? item.data.source : null;
        if (itemSource !== selectedBook) continue;
      }
      if ((currentMode === 'qa' && item.type === 'qa') || (currentMode === 'choice' && item.type === 'choice')) {
        _currentCacheIdx = idx;
        if (currentMode === 'qa') renderQAMode(item.data, onAnswerResult);
        else renderChoiceMode(item.data, onAnswerResult);
        return;
      }
    }
  }
  // 无 AI 缓存时检测配置状态并提示
  chrome.storage.local.get(['wx_ai_config'], function(r) {
    var aiOk = r.wx_ai_config && r.wx_ai_config.endpoint && r.wx_ai_config.apiKey && r.wx_ai_config.model;
    showState('display');
    if (aiOk) {
      noteContent.textContent = 'AI 已配置，但缓存为空。请在设置页点击「🤖 生成 AI 缓存」生成题目。';
    } else {
      noteContent.textContent = '请先在设置页配置 AI 接口（端点 / API Key / 模型名），生成题目后可在此查看。';
    }
    noteSource.innerHTML = '';
    showToast('⚙️ ' + (aiOk ? '请生成 AI 缓存' : '请先配置 AI 接口'), 3000);
  });
}

async function persistCache() {
  await storageSet({ [CACHE_KEY]: aiCache });
}

async function saveCacheIndex() {
  await storageSet({ wx_cache_index: cacheIndex });
}

// 显示 AI 知识点（浏览模式专用）
function displayKnowledgeItem(data) {
  showState('display');
  currentNote = { content: data.content, book: data.source, source: 'markdown' };
  if (data.source) {
    noteSource.innerHTML = '<div class="book-name">📖 ' + data.source + '</div>';
  } else {
    noteSource.innerHTML = '';
  }
  noteContent.textContent = data.content || '(无内容)';
  noteContent.classList.add('plain');
  card.classList.remove('card-enter');
  void card.offsetWidth;
  card.classList.add('card-enter');
  // 推进索引避免重复
  cacheIndex = (_currentCacheIdx + 1) % aiCache.length;
  saveCacheIndex();
  if (currentNote && currentNote.id) {
    markNoteAsSeen(currentNote.id);
  }
}

// 答对→移除，答错→保留轮转
async function onAnswerResult(correct) {
  if (!aiCache.length) return;
  if (_currentCacheIdx < 0) return;
  if (correct) {
    aiCache.splice(_currentCacheIdx, 1);
    await persistCache();
    cacheIndex = Math.min(_currentCacheIdx, aiCache.length - 1);
    if (cacheIndex < 0) cacheIndex = 0;
    addBrowseLog('cache', '答对移除，剩余 ' + aiCache.length + ' 条');
    if (aiCache.length === 0) {
      addBrowseLog('cache', '缓存已全部答对清空');
    }
  } else {
    cacheIndex = (_currentCacheIdx + 1) % aiCache.length;
    addBrowseLog('cache', '答错保留，下次循环');
  }
  await saveCacheIndex();
  _currentCacheIdx = -1;
}

async function restoreState() {
  return new Promise(function(resolve) {
    chrome.storage.local.get([MODE_KEY, CACHE_KEY, SOURCE_ENABLED_KEY, SETTINGS_KEY, 'wx_cache_index'], function(result) {
      if (result[MODE_KEY]) {
        currentMode = result[MODE_KEY];
        var modeSel = document.getElementById('modeSelect');
        if (modeSel) modeSel.value = currentMode;
      }
      if (result[CACHE_KEY]) aiCache = result[CACHE_KEY];
      if (result.wx_cache_index !== undefined) cacheIndex = result.wx_cache_index;
      if (result[SOURCE_ENABLED_KEY]) sourceEnabled = result[SOURCE_ENABLED_KEY];
      if (result[SETTINGS_KEY]) {
        excludeDocs = result[SETTINGS_KEY].excludedDocs || [];
      }
      resolve();
    });
  });
}

// ---- 标记笔记为已接触（防抖写入） ----
function markNoteAsSeen(noteId) {
  if (!noteId) return;
  pendingSeenIds.add(noteId);
  if (!seenFlushTimer) {
    seenFlushTimer = setTimeout(flushSeenIds, 0);
  }
}

let _flushingSeen = false;
async function flushSeenIds() {
  if (_flushingSeen) return; // 防止并发 flush
  _flushingSeen = true;
  seenFlushTimer = null;
  try {
    if (pendingSeenIds.size === 0) return;
    const ids = [...pendingSeenIds];
    const result = await storageGet('wx_learning_progress');
    const progress = result.wx_learning_progress || {};
    if (!progress.seenNoteIds) progress.seenNoteIds = [];
    let newCount = 0;
    ids.forEach(function(id) {
      if (progress.seenNoteIds.indexOf(id) === -1) {
        progress.seenNoteIds.push(id);
        newCount++;
      }
    });
    await storageSet({ wx_learning_progress: progress });
    // 写入成功后才清除 pending 队列
    pendingSeenIds.clear();
    // 同步记录浏览模式的今日已阅数
    if (newCount > 0 && typeof recordBrowseSeen === 'function') {
      await recordBrowseSeen(newCount);
    }
    // 新笔记已写入，刷新覆盖度面板
    if (newCount > 0 && typeof updateCoverageDisplay === 'function') {
      addBrowseLog('flushSeen', '刷入 ' + newCount + ' 条新浏览', { totalSeen: progress.seenNoteIds.length });
      await updateCoverageDisplay();
    }
  } catch (err) {
    console.error('flushSeenIds 失败:', err);
    addBrowseLog('flushSeen', '写入失败', { error: err.message });
    // 不清除 pendingSeenIds，下次重试
  } finally {
    _flushingSeen = false;
  }
}

// ---- 覆盖度面板 ----
async function updateCoverageDisplay() {
  var progress, allStats;
  try {
    const result = await Promise.all([
      storageGet('wx_learning_progress'),
      (typeof getReviewStats === 'function' ? getReviewStats() : Promise.resolve({}))
    ]);
    progress = result[0].wx_learning_progress || {};
    allStats = result[1];
    // getReviewStats 已处理迁移和默认值，直接使用
  } catch (e) {
    console.error('updateCoverageDisplay 读取失败', e);
    addBrowseLog('coverage', '读取失败', { error: e.message });
    return;
  }

  // 选择当前活跃模式的容器
  const isQaMode = currentMode === 'qa' || currentMode === 'choice';
  const containerId = isQaMode ? (currentMode === 'qa' ? 'coverage-qa' : 'coverage-choice') : 'coverage-browse';
  const container = document.getElementById(containerId);
  if (!container) return;

  var bookList, seenCount, total, qaAccuracy;
  var modeStats = currentMode === 'choice' ? allStats.choice : (currentMode === 'browse' ? allStats.browse : allStats.qa);

  if (currentMode === 'qa' || currentMode === 'choice') {
    // QA/选择题模式：基于缓存
    qaAccuracy = {};
    Object.keys(progress).forEach(function(key) {
      if (key.indexOf('__book_qa__') === 0) {
        var bookName = key.replace('__book_qa__', '');
        var d = progress[key];
        qaAccuracy[bookName] = d.total > 0 ? Math.round((d.correct / d.total) * 100) : -1;
      }
    });
    var bookSet = new Set();
    if (typeof aiCache !== 'undefined') {
      aiCache.forEach(function(item) {
        var src = item.data ? item.data.source : null;
        if (src) bookSet.add(src);
      });
    }
    bookList = Array.from(bookSet);
    total = aiCache ? aiCache.length : 0;
    // "已接触" = 有 QA 答题记录的缓存来源数
    var touchedSources = 0;
    bookList.forEach(function(b) {
      if (qaAccuracy[b] >= 0) touchedSources++;
    });
    seenCount = touchedSources;
  } else {
    // 浏览模式：基于笔记（尊重数据源/排除/选中书籍等过滤）
    const seenIdSet = new Set(progress.seenNoteIds || []);
    seenCount = filteredNotes.filter(n => seenIdSet.has(n.id)).length;
    total = filteredNotes.length;

    // 书单用按书过滤前的笔记列表，点书筛选后其他书不会消失
    var sourceForBooks = _filteredBySource && _filteredBySource.length ? _filteredBySource : filteredNotes;
    var bookSet = new Set();
    sourceForBooks.forEach(function(n) {
      bookSet.add(getNoteGroupKey(n));
    });
    bookList = Array.from(bookSet);

    qaAccuracy = {};
    Object.keys(progress).forEach(function(key) {
      if (key.indexOf('__book_qa__') === 0) {
        var bookName = key.replace('__book_qa__', '');
        var d = progress[key];
        qaAccuracy[bookName] = d.total > 0 ? Math.round((d.correct / d.total) * 100) : -1;
      }
    });
  }

  const pct = total > 0 ? Math.round((seenCount / total) * 100) : 0;

  // 按模式显示今日统计
  var metaParts = [];
  if (currentMode === 'browse') {
    if (modeStats.todaySeen > 0) metaParts.push('今日浏览 ' + modeStats.todaySeen + ' 条');
  } else {
    if (modeStats.todayTotal > 0) metaParts.push('今日 ' + modeStats.todayCorrect + '/' + modeStats.todayTotal);
  }
  if (modeStats.streakDays > 0) metaParts.push('🔥 ' + modeStats.streakDays + ' 天');
  const metaText = metaParts.join(' · ');

  let booksHtml = '';
  if (bookList.length > 0) {
    // qaAccuracy 按 book（文件夹名）存储，而 browse 模式的 bookList 用 getNoteGroupKey（MD 返回文件名）
    var displayToBook = {};
    if (currentMode === 'browse') {
      var srcB = _filteredBySource && _filteredBySource.length ? _filteredBySource : filteredNotes;
      srcB.forEach(function(n) {
        var d = getNoteGroupKey(n);
        if (!displayToBook[d]) displayToBook[d] = n.book || '(未归类)';
      });
    }
    booksHtml = buildBookChipsHtml(bookList, qaAccuracy, displayToBook);
  }

  // 增量更新 DOM，保留元素以实现平滑 CSS transition
  var headerEl = container.querySelector('.coverage-header');
  var wrapEl = container.querySelector('.coverage-progress-wrap');
  var barBgEl = container.querySelector('.coverage-bar-bg');
  var booksEl = container.querySelector('.coverage-books');

  if (!headerEl) {
    // 首次渲染：一次性构建
    container.innerHTML =
      '<div class="coverage-header">' +
        '<span class="coverage-title">📊 回忆进度条</span>' +
        '<span class="coverage-meta">' + metaText + '</span>' +
      '</div>' +
      '<div class="coverage-progress-wrap">' +
        '<span class="coverage-label">已接触 <strong>' + seenCount + '</strong>/' + total + ' 条</span>' +
        '<span class="coverage-pct">' + (total > 0 ? pct : '—') + '%</span>' +
      '</div>' +
      '<div class="coverage-bar-bg">' +
        '<div class="coverage-bar-fill" style="width:' + pct + '%"></div>' +
      '</div>' +
      '<div class="coverage-books">' + booksHtml + '</div>';
  } else {
    // 增量更新已有元素
    var metaEl = headerEl.querySelector('.coverage-meta');
    if (metaEl) metaEl.textContent = metaText;

    if (wrapEl) {
      var labelStrong = wrapEl.querySelector('.coverage-label strong');
      var pctEl = wrapEl.querySelector('.coverage-pct');
      if (labelStrong) {
        var prevVal = labelStrong.getAttribute('data-val');
        var newVal = String(seenCount);
        labelStrong.textContent = seenCount;
        // 更新 /Y 条（strong 后的文本节点）
        var next = labelStrong.nextSibling;
        if (next) next.textContent = '/' + total + ' 条';
        if (prevVal !== newVal) {
          labelStrong.setAttribute('data-val', newVal);
          restartAnimation(labelStrong);
        }
      }
      if (pctEl) {
        var newPct = (total > 0 ? pct : '—') + '%';
        if (pctEl.textContent !== newPct) {
          pctEl.textContent = newPct;
          restartAnimation(pctEl);
        }
      }
    }

    if (barBgEl) {
      var fillEl = barBgEl.querySelector('.coverage-bar-fill');
      if (fillEl) {
        var prevW = fillEl.getAttribute('data-pct');
        var newW = String(pct);
        if (prevW !== newW) {
          fillEl.setAttribute('data-pct', newW);
          fillEl.style.width = pct + '%';
        }
      }
    }

    if (booksEl) {
      booksEl.innerHTML = booksHtml;
    }
  }
  // 如果之前处于展开状态，恢复展开
  if (_coverageExpanded) {
    showAllBooksPanel();
  }
}

function selectBook(bookName) {
  selectedBook = bookName === selectedBook ? null : bookName;
  shownIds = [];
  noteHistory = [];
  updateFiltered();
  addBrowseLog('selectBook', selectedBook ? '选中「' + selectedBook + '」' : '取消筛选');
  if (currentMode === 'browse') {
    switchToNext();
  } else {
    cacheIndex = 0;
    loadNextInMode();
  }
  // 重绘覆盖度面板（数字/书籍列表随选中书籍变化）
  updateCoverageDisplay();
}

function updateBookChipHighlight() {
  var chips = document.querySelectorAll('.coverage-book-chip');
  for (var i = 0; i < chips.length; i++) {
    var chip = chips[i];
    var action = chip.dataset.action;
    if (action === 'random') {
      if (selectedBook === null) chip.classList.add('active');
      else chip.classList.remove('active');
    } else if (action === 'select') {
      if (chip.dataset.book === selectedBook) chip.classList.add('active');
      else chip.classList.remove('active');
    }
  }
}

function buildBookChipsHtml(bookList, qaAccuracy, displayToBook) {
  displayToBook = displayToBook || {};
  // 排序：有 QA 数据的优先，正确率低的优先
  var sorted = bookList.slice().sort(function(a, b) {
    var keyA = displayToBook[a] || a;
    var keyB = displayToBook[b] || b;
    var accA = qaAccuracy[keyA] >= 0 ? qaAccuracy[keyA] : 100;
    var accB = qaAccuracy[keyB] >= 0 ? qaAccuracy[keyB] : 100;
    if (accA < 60 && accB >= 60) return -1;
    if (accB < 60 && accA >= 60) return 1;
    return a.localeCompare(b);
  });

  // 🎲 随机按钮
  var html = '<span class="coverage-book-chip' + (selectedBook === null ? ' active' : '') + '" data-action="random">🎲 随机</span>';

  // 前 4 本（短书名优先）
  var visible = [];
  var remaining = [];
  sorted.forEach(function(name) {
    if (visible.length < 4 && name.length < 18) {
      visible.push(name);
    } else if (visible.length < 4 && remaining.length === 0) {
      visible.push(name);
    } else {
      remaining.push(name);
    }
  });

  visible.forEach(function(name) {
    var bookKey = displayToBook[name] || name;
    var pct = qaAccuracy[bookKey];
    var hasData = pct >= 0;
    var isWeak = hasData && pct < 60;
    var weakClass = isWeak ? ' weak' : '';
    var activeClass = name === selectedBook ? ' active' : '';
    var label = hasData ? (isWeak ? pct + '% ⚠️' : pct + '%') : '<span title="暂无答题记录">—</span>';
    html += '<span class="coverage-book-chip' + weakClass + activeClass + '" data-action="select" data-book="' + escapeHTML(name) + '" title="' + escapeHTML(name) + '">📖 <span class="chip-name">' + escapeHTML(name) + '</span> ' + label + '</span>';
  });

  if (remaining.length > 0) {
    html += '<span class="coverage-book-chip all-books" data-action="showAll">📚 全部 ' + sorted.length + ' 本 →</span>';
  }

  return html;
}

// 初始化覆盖度面板的点击事件（仅执行一次）
var _coverageHandlerInited = false;
function initCoverageClickHandler() {
  if (_coverageHandlerInited) return;
  _coverageHandlerInited = true;
  document.addEventListener('click', function(e) {
    var chip = e.target.closest('.coverage-book-chip');
    if (!chip) return;
    var action = chip.dataset.action;
    if (action === 'random') {
      selectBook(null);
    } else if (action === 'select') {
      selectBook(chip.dataset.book);
    } else if (action === 'showAll') {
      _coverageExpanded = true;
      showAllBooksPanel();
    } else if (action === 'collapse') {
      _coverageExpanded = false;
      updateCoverageDisplay();
    }
  });
}

function showAllBooksPanel() {
  storageGet('wx_learning_progress').then(function(data) {
    var progress = data.wx_learning_progress || {};

    // 读取 QA 正确率
    var qaAccuracy = {};
    Object.keys(progress).forEach(function(key) {
      if (key.indexOf('__book_qa__') === 0) {
        var bookName = key.replace('__book_qa__', '');
        var d = progress[key];
        qaAccuracy[bookName] = d.total > 0 ? Math.round((d.correct / d.total) * 100) : -1;
      }
    });

    var sourceForBooks = _filteredBySource && _filteredBySource.length ? _filteredBySource : filteredNotes;
    var uniqueBooks = Array.from(new Set(sourceForBooks.map(function(n) { return getNoteGroupKey(n); }).filter(Boolean)));

    // qaAccuracy 按 book（文件夹名）存储，而 getNoteGroupKey 对 MD 返回文件名 → 建立映射
    var displayToBook = {};
    sourceForBooks.forEach(function(n) {
      var display = getNoteGroupKey(n);
      if (!displayToBook[display]) displayToBook[display] = n.book || '(未归类)';
    });

    var containerId = currentMode === 'qa' ? 'coverage-qa' : currentMode === 'choice' ? 'coverage-choice' : 'coverage-browse';
    var container = document.getElementById(containerId);
    if (!container) return;

    var booksContainer = container.querySelector('.coverage-books');
    if (!booksContainer) return;

    var html = '<span class="coverage-book-chip' + (selectedBook === null ? ' active' : '') + '" data-action="random">🎲 随机</span>';
    uniqueBooks.forEach(function(book) {
      // 通过 display→book 映射查找 qaAccuracy，找不到时直接查
      var bookKey = displayToBook[book] || book;
      var pct = qaAccuracy[bookKey];
      var hasData = pct >= 0;
      var isWeak = hasData && pct < 60;
      var weakClass = isWeak ? ' weak' : '';
      var activeClass = book === selectedBook ? ' active' : '';
      var label = hasData ? (isWeak ? pct + '% ⚠️' : pct + '%') : '<span title="暂无答题记录">—</span>';
      html += '<span class="coverage-book-chip' + weakClass + activeClass + '" data-action="select" data-book="' + escapeHTML(book) + '" title="' + escapeHTML(book) + '">📖 <span class="chip-name">' + escapeHTML(book) + '</span> ' + label + '</span>';
    });
    html += '<span class="coverage-book-chip all-books active" data-action="collapse">↑ 收起</span>';
    booksContainer.innerHTML = html;
  });
}

// 笔记在进度条面板中的显示/分组键：
// - 微信读书笔记 → 书名 (n.book)
// - Markdown 笔记 → 文件名 (n.filePath)
function getNoteGroupKey(n) {
  if (n.source === 'markdown' && n.filePath) {
    // 提取文件名（去掉路径部分）
    var parts = n.filePath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || n.book || '未知';
  }
  return n.book || '(未归类)';
}

function applyBookFilter() {
  if (selectedBook !== null) {
    filteredNotes = filteredNotes.filter(function(n) {
      return getNoteGroupKey(n) === selectedBook;
    });
  }
}

async function initCoveragePanel() {
  await updateCoverageDisplay();
}

// ---- Init ----
async function init() {
  addBrowseLog('init', '启动', { allNotesCount: allNotes.length, mode: currentMode });
  try {
    await restoreState();
    initModeSwitch();
    initCoverageClickHandler();
    const data = await loadAll();
    allNotes = data[STORAGE_KEY] || [];
    const settings = data[SETTINGS_KEY] || {};
    excludeBooks = settings.excludedBooks || [];

    stats.total = allNotes.length;
    updateFiltered();
    stats.excluded = allNotes.length - filteredNotes.length;

    await initCoveragePanel();
    addBrowseLog('init', '数据就绪', { allNotes: allNotes.length, filtered: filteredNotes.length, excluded: stats.excluded, mode: currentMode });

    if (!allNotes.length) {
      addBrowseLog('init', '无笔记，显示空状态');
      showState('empty');
      return;
    }

    if (!filteredNotes.length) {
      addBrowseLog('init', '全部被过滤，显示过滤状态');
      showState('filtered');
      return;
    }

    loadNextInMode();

  } catch (err) {
    console.error('微信书摘: 加载笔记失败', err);
    addBrowseLog('init', '启动失败', { error: err.message, stack: (err.stack || '').slice(0, 200) });
    showState('empty');
    document.querySelector('#state-empty .empty-desc').textContent =
      '加载笔记时出错：' + err.message;
  }
}

// ======== Canvas 书摘卡片渲染（替换 html2canvas） ========

// ---- Copy as image ----
btnCopy.addEventListener('click', async () => {
  if (!currentNote) return;
  showToast('📸 正在生成书摘图片...');

  try {
    const canvas = renderNoteCard(currentNote);
    const blob = await new Promise(function (resolve) {
      canvas.toBlob(resolve, 'image/png');
    });
    if (!blob) throw new Error('生成图片失败');

    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob })
    ]);
    showToast('✅ 书摘图片已复制到剪贴板');
  } catch (err) {
    console.error('复制失败:', err);
    showToast('❌ 生成图片失败');
  }
});

/**
 * 用 Canvas 2D API 渲染书摘卡片，文字清晰锐利
 */
function renderNoteCard(note) {
  var PAD = 52;
  var PAD_TOP = 56;
  var CARD_W = 780;
  var QUOTE_SIZE = 56;
  var FONT_SIZE = 22;
  var LINE_HEIGHT = 40;
  var SOURCE_GAP = 28;
  var SOURCE_LINE_TOP = 16;
  var BOTTOM_PAD = 44;
  var DPR = 3;
  var MAX_LINES = 100; // 超出 100 行不渲染，防止 canvas 超限

  var maxTextWidth = CARD_W - PAD * 2;

  // 临时 canvas 测量文字
  var tempCanvas = document.createElement('canvas');
  var tempCtx = tempCanvas.getContext('2d');
  tempCtx.font = FONT_SIZE + 'px "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif';

  var content = (note.content || '').slice(0, 3000);
  var lines = wrapChineseText(tempCtx, content, maxTextWidth);
  if (lines.length > MAX_LINES) {
    lines = lines.slice(0, MAX_LINES);
    lines[MAX_LINES - 1] = '……';
  }
  var textHeight = lines.length * LINE_HEIGHT;

  var hasSource = !!(note.book || note.author || note.chapter);
  var sourceHeight = hasSource ? 68 : 0;

  var CARD_H = PAD_TOP + textHeight + SOURCE_GAP + sourceHeight + BOTTOM_PAD;

  // 高分辨率 canvas
  var canvas = document.createElement('canvas');
  canvas.width = CARD_W * DPR;
  canvas.height = CARD_H * DPR;
  var ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);

  // ---- 阴影 ----
  ctx.shadowColor = 'rgba(0,0,0,0.06)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 4;
  roundRect(ctx, 0, 0, CARD_W, CARD_H, 18);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // ---- 背景（覆盖阴影内部） ----
  roundRect(ctx, 0, 0, CARD_W, CARD_H, 18);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // ---- 边框 ----
  ctx.strokeStyle = '#f0ede7';
  ctx.lineWidth = 1;
  roundRect(ctx, 0, 0, CARD_W, CARD_H, 18);
  ctx.stroke();

  // ---- 引号 ----
  ctx.font = QUOTE_SIZE + 'px Georgia, "Noto Serif CJK SC", serif';
  ctx.fillStyle = 'rgba(90, 122, 90, 0.18)';
  ctx.textBaseline = 'top';
  ctx.fillText('"', 28, 12);

  // ---- 笔记正文 ----
  ctx.font = FONT_SIZE + 'px "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif';
  ctx.fillStyle = '#2c2c2c';
  ctx.textBaseline = 'top';

  var y = PAD_TOP;
  for (var i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], PAD, y);
    y += LINE_HEIGHT;
  }

  // ---- 书名 / 作者 ----
  if (hasSource) {
    var sourceY = y + SOURCE_GAP;

    // 分隔线
    ctx.strokeStyle = '#e8e3da';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, sourceY);
    ctx.lineTo(CARD_W - PAD, sourceY);
    ctx.stroke();

    var labelY = sourceY + SOURCE_LINE_TOP;

    if (note.book) {
      ctx.font = 'bold 15px -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif';
      ctx.fillStyle = '#2c2c2c';
      ctx.textBaseline = 'top';
      var bookText = '《' + note.book + '》';
      ctx.fillText(bookText, PAD, labelY);

      if (note.author || note.chapter) {
        var metaParts = [];
        if (note.author) metaParts.push(note.author);
        if (note.chapter) metaParts.push(note.chapter);
        ctx.font = '13px -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif';
        ctx.fillStyle = '#8b8579';
        ctx.textBaseline = 'top';
        // 换行显示，不与书名同行
        ctx.fillText(metaParts.join(' · '), PAD, labelY + 22);
      }
    } else if (note.author || note.chapter) {
      var metaParts = [];
      if (note.author) metaParts.push(note.author);
      if (note.chapter) metaParts.push(note.chapter);
      ctx.font = '13px -apple-system, "PingFang SC", "Noto Sans CJK SC", sans-serif';
      ctx.fillStyle = '#2c2c2c';
      ctx.textBaseline = 'top';
      ctx.fillText(metaParts.join(' · '), PAD, labelY);
    }
  }

  return canvas;
}

/** 中文文本按字符换行 */
function wrapChineseText(ctx, text, maxWidth) {
  if (!text) return [''];
  var lines = [];
  var current = '';
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    var test = current + ch;
    if (ctx.measureText(test).width > maxWidth && current.length > 0) {
      lines.push(current);
      current = ch;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** 测量文本宽度 */
function measureTextWidth(ctx, text) {
  return ctx.measureText(text).width;
}

/** Canvas roundRect */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ---- Delete ----
btnDelete.addEventListener('click', () => {
  if (!currentNote) return;
  showConfirmDialog('确定要删除这条笔记吗？删除后不可恢复。', async () => {
    const idx = allNotes.findIndex(n => n.id === currentNote.id);
    if (idx !== -1) {
      var deletedNote = currentNote;
      allNotes.splice(idx, 1);
      await saveNotes(allNotes);
      stats.total = allNotes.length;
      updateFiltered();
      stats.excluded = allNotes.length - filteredNotes.length;
      shownIds = shownIds.filter(id => id !== currentNote.id);
      addBrowseLog('delete', '删除笔记', { id: deletedNote.id.slice(0,20), book: deletedNote.book, remaining: allNotes.length });
      showToast('🗑️ 已删除');
      switchToNext();
    }
  });
});

// ---- Confirm dialog（防叠加）----
let _confirmOverlay = null;
function showConfirmDialog(message, onConfirm) {
  if (_confirmOverlay) { _confirmOverlay.remove(); _confirmOverlay = null; }
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <p>${escapeHTML(message)}</p>
      <div class="confirm-actions">
        <button class="btn" id="confirmCancel">取消</button>
        <button class="btn btn-danger" id="confirmOk">确定删除</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  _confirmOverlay = overlay;

  const close = () => { overlay.remove(); if (_confirmOverlay === overlay) _confirmOverlay = null; };
  overlay.querySelector('#confirmCancel').addEventListener('click', close);
  overlay.querySelector('#confirmOk').addEventListener('click', () => {
    close();
    onConfirm();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

// ---- Next ----
btnNext.addEventListener('click', () => {
  switchToNext();
});

// ---- Prev ----
btnPrev.addEventListener('click', () => switchToPrev());

// ---- Keyboard shortcuts ----
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'n') {
    e.preventDefault();
    if (currentMode === 'qa') {
      var qaNext = document.getElementById('qaNext');
      if (qaNext) qaNext.click();
    } else if (currentMode === 'choice') {
      var choiceNext = document.getElementById('choiceNext');
      if (choiceNext) choiceNext.click();
    } else {
      btnNext.click();
    }
  } else if (e.key === 'ArrowLeft' || e.key === 'p') {
    e.preventDefault();
    if (currentMode === 'qa') {
      var qaPrev = document.getElementById('qaPrev');
      if (qaPrev) qaPrev.click();
    } else if (currentMode === 'choice') {
      var choicePrev = document.getElementById('choicePrev');
      if (choicePrev) choicePrev.click();
    } else {
      btnPrev.click();
    }
  } else if (e.key === 'd' || e.key === 'Delete') {
    if (currentMode === 'browse') btnDelete.click();
  }
});

// ---- Settings FAB (bottom-right) ----
document.getElementById('fabSettings').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ---- Settings page link (empty states) ----
document.getElementById('goToSettings').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
document.getElementById('goToSettingsFiltered').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// ---- Listen for storage changes ----
chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEY]) {
    allNotes = changes[STORAGE_KEY].newValue || [];
    stats.total = allNotes.length;
    updateFiltered();
    stats.excluded = allNotes.length - filteredNotes.length;
    if (currentNote && !allNotes.find(n => n.id === currentNote.id)) {
      switchToNext();
    }
    updateCoverageDisplay();
  }
  if (changes[SETTINGS_KEY]) {
    const s = changes[SETTINGS_KEY].newValue || {};
    excludeBooks = s.excludedBooks || [];
    excludeDocs = s.excludedDocs || [];
    updateFiltered();
    stats.excluded = allNotes.length - filteredNotes.length;
    updateCoverageDisplay();
  }
  if (changes[SOURCE_ENABLED_KEY]) {
    sourceEnabled = changes[SOURCE_ENABLED_KEY].newValue || {};
    updateFiltered();
    stats.excluded = allNotes.length - filteredNotes.length;
    updateCoverageDisplay();
  }
});

// ---- Start ----
init();

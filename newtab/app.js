/* ============================================
   微信书摘 · 新标签页 — App Logic
   ============================================ */

// ---- Storage helpers ----
const STORAGE_KEY = 'wx_notes';
const SETTINGS_KEY = 'wx_settings';
const MODE_KEY = 'wx_display_mode';
const CACHE_KEY = 'wx_ai_cache';
const SOURCE_ENABLED_KEY = 'wx_source_enabled';

async function loadAll() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY], (result) => {
      resolve(result);
    });
  });
}

async function saveNotes(notes) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: notes }, resolve);
  });
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
        var src = n.source || 'weread';
        return enabledSources.some(function(s) {
          // Match weread notes (no source field) against "weread" key
          if (s === 'weread' && src === 'weread') return true;
          // Match markdown notes against "md_<name>" keys
          if (s.startsWith('md_') && src === 'markdown') return true;
          return false;
        });
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
    currentMode = sel.value;
    chrome.storage.local.set({ [MODE_KEY]: currentMode });
    addBrowseLog('mode', '切至 ' + currentMode);
    shownIds = [];
    noteHistory = [];
    loadNextInMode();
  });
}

function addBrowseLog(type, detail) {
  var entry = { ts: new Date().toISOString(), type: type, status: 'ok' };
  if (detail) entry.detail = detail;
  chrome.storage.local.get(['wx_ai_log'], function(r) {
    var logs = r.wx_ai_log || [];
    logs.push(entry);
    if (logs.length > 500) logs.splice(0, logs.length - 500);
    chrome.storage.local.set({ wx_ai_log: logs });
  });
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
          var itemSrcType = item.srcType || 'weread';
          var srcMatch = enabledSrcs.some(function(s) {
            if (s === 'weread' && itemSrcType === 'weread') return true;
            if (s.startsWith('md_') && itemSrcType === 'markdown') return true;
            return false;
          });
          if (!srcMatch) continue;
        }
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
    saveCacheIndex();
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
          var srcMatch = enabledSrcs.some(function(s) {
            if (s === 'weread' && itemSrcType === 'weread') return true;
            if (s.startsWith('md_') && itemSrcType === 'markdown') return true;
            return false;
          });
          if (!srcMatch) continue; // 跳过不匹配来源的条目
        }
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
  await new Promise(function(r) { chrome.storage.local.set({ [CACHE_KEY]: aiCache }, r); });
}

async function saveCacheIndex() {
  await new Promise(function(r) { chrome.storage.local.set({ wx_cache_index: cacheIndex }, r); });
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
}

// 答对→移除，答错→保留轮转
function onAnswerResult(correct) {
  if (!aiCache.length) return;
  if (_currentCacheIdx < 0) return;
  if (correct) {
    aiCache.splice(_currentCacheIdx, 1);
    persistCache();
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
  saveCacheIndex();
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

// ---- Init ----
async function init() {
  try {
    await restoreState();
    initModeSwitch();
    const data = await loadAll();
    allNotes = data[STORAGE_KEY] || [];
    const settings = data[SETTINGS_KEY] || {};
    excludeBooks = settings.excludedBooks || [];

    stats.total = allNotes.length;
    updateFiltered();
    stats.excluded = allNotes.length - filteredNotes.length;

    if (!allNotes.length) {
      showState('empty');
      return;
    }

    if (!filteredNotes.length) {
      showState('filtered');
      return;
    }

    showState('display');
    const first = pickNext();
    if (first) {
      renderNote(first);
      card.classList.add('card-enter');
    } else {
      showState('empty');
    }

  } catch (err) {
    console.error('微信书摘: 加载笔记失败', err);
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
      allNotes.splice(idx, 1);
      await saveNotes(allNotes);
      stats.total = allNotes.length;
      updateFiltered();
      stats.excluded = allNotes.length - filteredNotes.length;
      shownIds = shownIds.filter(id => id !== currentNote.id);
      showToast('🗑️ 已删除');
      switchToNext();
    }
  });
});

// ---- Confirm dialog ----
function showConfirmDialog(message, onConfirm) {
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

  const close = () => overlay.remove();
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
  }
  if (changes[SETTINGS_KEY]) {
    const s = changes[SETTINGS_KEY].newValue || {};
    excludeBooks = s.excludedBooks || [];
    excludeDocs = s.excludedDocs || [];
    updateFiltered();
    stats.excluded = allNotes.length - filteredNotes.length;
  }
});

// ---- Start ----
init();

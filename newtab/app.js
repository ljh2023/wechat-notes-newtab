/* ============================================
   微信书摘 · 新标签页 — App Logic
   ============================================ */

// ---- Storage helpers ----
const STORAGE_KEY = 'wx_notes';
const SETTINGS_KEY = 'wx_settings';

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
const btnDelete    = document.getElementById('btnDelete');
const toast        = document.getElementById('toast');

// ---- State ----
let allNotes = [];
let filteredNotes = [];
let shownIds = [];
let currentNote = null;
let excludeBooks = [];
let stats = { total: 0, excluded: 0 };

// ---- Show/hide states ----
function showState(name) {
  Object.keys(states).forEach(k => {
    states[k].classList.toggle('active', k === name);
  });
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
  if (!excludeBooks.length) {
    filteredNotes = allNotes;
  } else {
    const excludeSet = new Set(excludeBooks.map(b => b.toLowerCase().trim()));
    filteredNotes = allNotes.filter(n => !excludeSet.has((n.book || '').toLowerCase().trim()));
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

// ---- Render note ----
function renderNote(note) {
  currentNote = note;

  noteContent.textContent = note.content || '(无内容)';

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
  info += ' &middot; <a href="#" id="openSettingsLink">设置</a>';
  footerInfo.innerHTML = info;

  const settingsLink = document.getElementById('openSettingsLink');
  if (settingsLink) {
    settingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
}

function escapeHTML(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Switch to next note (with animation) ----
function switchToNext() {
  const next = pickNext();
  if (!next) {
    if (excludeBooks.length > 0 && allNotes.length > 0) {
      showState('filtered');
    } else {
      showState('empty');
    }
    currentNote = null;
    return;
  }

  card.classList.add('card-exit');
  card.classList.remove('card-enter');

  setTimeout(() => {
    renderNote(next);
    card.classList.remove('card-exit');
    void card.offsetWidth;
    card.classList.add('card-enter');
  }, 250);
}

// ---- Init ----
async function init() {
  try {
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

  var maxTextWidth = CARD_W - PAD * 2;

  // 临时 canvas 测量文字
  var tempCanvas = document.createElement('canvas');
  var tempCtx = tempCanvas.getContext('2d');
  tempCtx.font = FONT_SIZE + 'px "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif';

  var lines = wrapChineseText(tempCtx, note.content, maxTextWidth);
  var textHeight = lines.length * LINE_HEIGHT;

  var hasSource = !!(note.book || note.author || note.chapter);
  var sourceHeight = hasSource ? 48 : 0;

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
        var bookWidth = measureTextWidth(ctx, bookText);
        ctx.fillText(metaParts.join(' · '), PAD + bookWidth + 12, labelY);
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
btnNext.addEventListener('click', () => switchToNext());

// ---- Keyboard shortcuts ----
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key) {
    case 'ArrowRight':
    case 'n':
    case ' ':
      e.preventDefault();
      btnNext.click();
      break;
    case 'c':
      btnCopy.click();
      break;
    case 'd':
    case 'Delete':
      btnDelete.click();
      break;
  }
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
    updateFiltered();
    stats.excluded = allNotes.length - filteredNotes.length;
  }
});

// ---- Start ----
init();

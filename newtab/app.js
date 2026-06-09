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
let allNotes = [];       // 全部笔记
let filteredNotes = [];  // 排除黑名单后的可用笔记
let shownIds = [];       // 本轮已展示过的 note id（用于防重复）
let currentNote = null;
let excludeBooks = [];   // 被排除的书名列表
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

  // 如果所有笔记都已看过，重置 shownIds
  if (shownIds.length >= filteredNotes.length) {
    shownIds = [];
  }

  const seen = new Set(shownIds);
  const candidates = filteredNotes.filter(n => !seen.has(n.id));

  if (!candidates.length) {
    // 不应发生，但兜底
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
      ? ` · ${note.chapter}`
      : '';
    noteSource.innerHTML = `
      <div class="book-name">《${escapeHTML(note.book)}》</div>
      <div class="book-meta">${escapeHTML(note.author || '')}${chapterHTML}</div>
    `;
  } else {
    noteSource.innerHTML = '';
  }

  // 更新底部统计
  const activeCount = filteredNotes.length;
  const totalCount  = allNotes.length;
  let info = `共 ${totalCount} 条笔记`;
  if (stats.excluded > 0) {
    info += ` · 已排除 ${stats.excluded} 条`;
  }
  info += ` · <a href="#" id="openSettingsLink">设置</a>`;
  footerInfo.innerHTML = info;

  // 绑定设置链接
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

  // Exit animation
  card.classList.add('card-exit');
  card.classList.remove('card-enter');

  setTimeout(() => {
    renderNote(next);
    card.classList.remove('card-exit');
    // Trigger reflow for re-animation
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

    // 正常展示
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

// ---- Copy as image ----
btnCopy.addEventListener('click', async () => {
  if (!currentNote) return;
  showToast('📸 正在生成书摘图片...');

  try {
    const canvas = await html2canvas(card, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });

    canvas.toBlob(async (blob) => {
      if (!blob) {
        showToast('❌ 生成图片失败');
        return;
      }
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        showToast('✅ 书摘图片已复制到剪贴板');
      } catch (clipErr) {
        console.error('Clipboard write failed:', clipErr);
        // Fallback: 复制文字
        try {
          const text = currentNote.content + (currentNote.book ? ` ——《${currentNote.book}》` : '');
          await navigator.clipboard.writeText(text);
          showToast('⚠️ 图片复制不支持，已复制文字版本');
        } catch {
          showToast('❌ 复制失败');
        }
      }
    }, 'image/png');
  } catch (err) {
    console.error('html2canvas failed:', err);
    showToast('❌ 图片生成失败');
  }
});

// ---- Delete ----
btnDelete.addEventListener('click', () => {
  if (!currentNote) return;
  showConfirmDialog('确定要删除这条笔记吗？删除后不可恢复。', async () => {
    // 从数组中移除
    const idx = allNotes.findIndex(n => n.id === currentNote.id);
    if (idx !== -1) {
      allNotes.splice(idx, 1);
      await saveNotes(allNotes);
      stats.total = allNotes.length;
      updateFiltered();
      stats.excluded = allNotes.length - filteredNotes.length;
      // 从 shownIds 中也移除
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
  // 不处理输入框内的按键
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

// ---- Listen for storage changes (update if settings changed elsewhere) ----
chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEY]) {
    allNotes = changes[STORAGE_KEY].newValue || [];
    stats.total = allNotes.length;
    updateFiltered();
    stats.excluded = allNotes.length - filteredNotes.length;
    // 如果当前显示的是被删除的笔记，切换到下一条
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

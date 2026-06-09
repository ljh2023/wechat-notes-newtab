/* ============================================
   微信书摘 · 设置 — App Logic
   ============================================ */

const STORAGE_KEY = 'wx_notes';
const SETTINGS_KEY = 'wx_settings';
const API_KEY_STORAGE = 'wx_api_key';

const SKILL_VERSION = '1.0.3';
const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';

let allNotes = [];
let excludeBooks = [];

// ---- DOM refs ----
const fileInput     = document.getElementById('fileInput');
const uploadArea    = document.getElementById('uploadArea');
const jsonInput     = document.getElementById('jsonInput');
const btnImport     = document.getElementById('btnImport');
const importResult  = document.getElementById('importResult');
const showSample    = document.getElementById('showSample');
const sampleFormat  = document.getElementById('sampleFormat');
const bookList      = document.getElementById('bookList');
const statsTotal    = document.getElementById('statTotal');
const statsActive   = document.getElementById('statActive');
const statsExcluded = document.getElementById('statExcluded');
const statsBooks    = document.getElementById('statBooks');
const btnClearAll   = document.getElementById('btnClearAll');
const toast         = document.getElementById('toast');

// ---- Sync DOM refs ----
const apiKeyInput      = document.getElementById('apiKeyInput');
const btnOpenSkills    = document.getElementById('btnOpenSkills');
const btnSync          = document.getElementById('btnSync');
const syncProgress     = document.getElementById('syncProgress');
const syncProgressFill = document.getElementById('syncProgressFill');
const syncProgressText = document.getElementById('syncProgressText');
const syncResult       = document.getElementById('syncResult');

// ---- Toast ----
let toastTimer = null;
function showToast(msg, duration = 2500) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ---- Storage ----
async function loadData() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY, API_KEY_STORAGE], (result) => {
      resolve(result);
    });
  });
}

async function saveData() {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      [STORAGE_KEY]: allNotes,
      [SETTINGS_KEY]: { excludedBooks: excludeBooks },
      [API_KEY_STORAGE]: apiKeyInput ? apiKeyInput.value.trim() : '',
    }, resolve);
  });
}

async function saveApiKey(key) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [API_KEY_STORAGE]: key }, resolve);
  });
}

// ---- Import Notes ----
function parseAndImport(jsonStr) {
  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    showImportResult('❌ JSON 解析失败：' + e.message, 'error');
    return;
  }

  // 支持数组（多条笔记）或单条笔记对象
  let notes = Array.isArray(data) ? data : [data];

  if (!notes.length) {
    showImportResult('❌ 导入的数据为空', 'error');
    return;
  }

  // 校验每条笔记至少包含 id 和 content
  const valid = [];
  const errors = [];
  notes.forEach((n, i) => {
    if (!n.id || !n.content) {
      errors.push(`第 ${i + 1} 条缺少 id 或 content 字段`);
    } else {
      valid.push({
        id: String(n.id),
        content: String(n.content).trim(),
        book: n.book || '',
        author: n.author || '',
        chapter: n.chapter || '',
        createTime: n.createTime || '',
      });
    }
  });

  if (!valid.length) {
    showImportResult('❌ 没有有效的笔记数据。每条笔记至少需要 id 和 content 字段。', 'error');
    return;
  }

  // 按 id 去重（保留新导入的）
  const existingIds = new Set(allNotes.map(n => n.id));
  let added = 0;
  valid.forEach(n => {
    if (!existingIds.has(n.id)) {
      allNotes.push(n);
      existingIds.add(n.id);
      added++;
    }
  });

  // 更新排除列表：如果有新书
  const bookSet = new Set(allNotes.map(n => n.book).filter(Boolean));
  excludeBooks = excludeBooks.filter(b => bookSet.has(b));

  saveData().then(() => {
    showImportResult(
      `✅ 导入成功！新增 ${added} 条笔记，跳过 ${valid.length - added} 条重复。当前共 ${allNotes.length} 条笔记。`,
      'success'
    );
    refreshUI();
    jsonInput.value = '';
  });
}

function showImportResult(msg, type) {
  importResult.textContent = msg;
  importResult.className = 'import-result ' + type;
}

// ---- Build book list ----
function buildBookList() {
  // 统计每本书的笔记数量
  const bookCounts = {};
  allNotes.forEach(n => {
    const book = n.book;
    if (!book) return;
    bookCounts[book] = (bookCounts[book] || 0) + 1;
  });

  const books = Object.keys(bookCounts).sort((a, b) => bookCounts[b] - bookCounts[a]);

  if (!books.length) {
    bookList.innerHTML = '<p class="no-data">没有关联书籍的笔记数据。</p>';
    return;
  }

  const excludeSet = new Set(excludeBooks);
  let html = '';
  books.forEach(book => {
    const isExcluded = excludeSet.has(book);
    html += `
      <div class="book-item">
        <div class="book-info">
          <span class="book-name">《${escapeHTML(book)}》</span>
          <span class="book-note-count">${bookCounts[book]} 条笔记</span>
        </div>
        <label class="toggle">
          <input type="checkbox" class="book-toggle" data-book="${escapeHTML(book)}" ${isExcluded ? '' : 'checked'} />
          <span class="slider"></span>
        </label>
      </div>
    `;
  });
  bookList.innerHTML = html;

  // 绑定 toggle 事件
  document.querySelectorAll('.book-toggle').forEach(el => {
    el.addEventListener('change', async (e) => {
      const book = e.target.dataset.book;
      if (e.target.checked) {
        // 取消排除
        excludeBooks = excludeBooks.filter(b => b !== book);
      } else {
        // 排除
        if (!excludeBooks.includes(book)) {
          excludeBooks.push(book);
        }
      }
      await saveData();
      updateStats();
      showToast(e.target.checked ? `已取消排除《${book}》` : `已排除《${book}》`);
    });
  });
}

function escapeHTML(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Update stats ----
function updateStats() {
  const total = allNotes.length;
  const excludeSet = new Set(excludeBooks.map(b => b.toLowerCase().trim()));
  const active = allNotes.filter(n => !excludeSet.has((n.book || '').toLowerCase().trim())).length;
  const excluded = total - active;

  // 书籍数量（含被排除的）
  const uniqueBooks = new Set(allNotes.map(n => n.book).filter(Boolean));

  statsTotal.textContent   = total;
  statsActive.textContent  = active;
  statsExcluded.textContent = excluded;
  statsBooks.textContent   = uniqueBooks.size;
}

// ---- Refresh entire UI ----
function refreshUI() {
  buildBookList();
  updateStats();
}

// ---- Init ----
async function init() {
  try {
    const data = await loadData();
    allNotes = data[STORAGE_KEY] || [];
    const settings = data[SETTINGS_KEY] || {};
    excludeBooks = settings.excludedBooks || [];
    // 恢复已保存的 API Key
    if (data[API_KEY_STORAGE] && apiKeyInput) {
      apiKeyInput.value = data[API_KEY_STORAGE];
    }
    refreshUI();
  } catch (err) {
    console.error('微信书摘: 加载数据失败', err);
    showToast('❌ 加载数据失败：' + err.message);
  }
}

// ---- Events ----

// 导入按钮
btnImport.addEventListener('click', () => {
  const text = jsonInput.value.trim();
  if (!text) {
    showImportResult('⚠️ 请先粘贴 JSON 数据', 'error');
    return;
  }
  parseAndImport(text);
});

// 上传文件
uploadArea.addEventListener('click', () => fileInput.click());

uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});
uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragover');
});
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length) handleFile(files[0]);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
  fileInput.value = '';
});

function handleFile(file) {
  if (!file.name.endsWith('.json')) {
    showImportResult('⚠️ 请上传 .json 文件', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    jsonInput.value = e.target.result;
    parseAndImport(e.target.result);
  };
  reader.onerror = () => {
    showImportResult('❌ 文件读取失败', 'error');
  };
  reader.readAsText(file);
}

// 显示示例格式
showSample.addEventListener('click', (e) => {
  e.preventDefault();
  sampleFormat.style.display = sampleFormat.style.display === 'none' ? 'block' : 'none';
});

// 清空数据
btnClearAll.addEventListener('click', () => {
  if (allNotes.length === 0) {
    showToast('⚠️ 没有数据可清空');
    return;
  }
  if (confirm('确定要清空所有笔记数据吗？此操作不可撤销！')) {
    allNotes = [];
    excludeBooks = [];
    saveData().then(() => {
      refreshUI();
      showToast('✅ 已清空所有数据');
    });
  }
});

// ---- Sync: WeChat Reading Skills API ----

function showSyncResult(msg, type) {
  syncResult.textContent = msg;
  syncResult.className = 'import-result ' + type;
}

function updateSyncProgress(pct, text) {
  syncProgressFill.style.width = pct + '%';
  syncProgressText.textContent = text;
}

async function callWereadApi(apiName, params = {}) {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    throw new Error('请先输入 API Key');
  }
  const res = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_name: apiName,
      skill_version: SKILL_VERSION,
      ...params,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data && typeof data.errcode === 'number' && data.errcode !== 0) {
    throw new Error(data.errmsg || `错误码 ${data.errcode}`);
  }
  return data;
}

async function syncFromWeRead() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    showSyncResult('⚠️ 请先获取并粘贴 API Key', 'error');
    return;
  }

  // 保存 API Key
  await saveApiKey(apiKey);

  // 显示进度
  syncProgress.style.display = 'block';
  btnSync.disabled = true;
  btnSync.textContent = '同步中...';
  showSyncResult('', '');

  try {
    updateSyncProgress(5, '正在获取笔记本列表...');

    // Step 1: 获取所有有笔记的书籍
    const notebooksData = await callWereadApi('/user/notebooks', { count: 100 });
    const books = notebooksData.books || [];
    if (!books.length) {
      showSyncResult('⚠️ 没有找到有笔记的书籍', 'error');
      btnSync.disabled = false;
      btnSync.textContent = '开始同步';
      return;
    }

    updateSyncProgress(15, `找到 ${books.length} 本书，正在获取笔记...`);

    // Step 2: 遍历每本书，获取划线/想法
    const imported = [];
    let processed = 0;

    for (const book of books) {
      const bookId = book.bookId;
      const bookTitle = book.book?.title || bookId;
      const bookAuthor = book.book?.author || '';

      processed++;
      const pct = 15 + Math.round((processed / books.length) * 70);
      updateSyncProgress(pct, `[${processed}/${books.length}] ${bookTitle}...`);

      // 获取划线（高亮）
      try {
        const bookmarkData = await callWereadApi('/book/bookmarklist', { bookId });
        const chapters = bookmarkData.chapters || [];
        const chapterMap = {};
        chapters.forEach(ch => { chapterMap[ch.chapterUid] = ch.title; });

        const bookmarks = bookmarkData.updated || [];
        bookmarks.forEach(bm => {
          imported.push({
            id: 'bm_' + bm.bookmarkId,
            content: (bm.markText || '').trim(),
            book: bookTitle,
            author: bookAuthor,
            chapter: chapterMap[bm.chapterUid] || '',
            createTime: bm.createTime ? new Date(bm.createTime * 1000).toISOString().split('T')[0] : '',
          });
        });
      } catch (e) {
        console.warn(`获取《${bookTitle}》划线失败:`, e);
      }

      // 获取个人想法
      try {
        const reviewData = await callWereadApi('/review/list/mine', {
          bookid: bookId,
          count: 100,
        });
        const reviews = reviewData.reviews || [];
        reviews.forEach(r => {
          const item = r.review || r;
          imported.push({
            id: 'rv_' + item.reviewId,
            content: (item.content || '').trim(),
            book: bookTitle,
            author: bookAuthor,
            chapter: item.chapterName || '',
            createTime: item.createTime ? new Date(item.createTime * 1000).toISOString().split('T')[0] : '',
          });
        });
      } catch (e) {
        console.warn(`获取《${bookTitle}》想法失败:`, e);
      }
    }

    updateSyncProgress(92, '正在去重合并...');

    if (!imported.length) {
      showSyncResult('⚠️ 未能获取到任何笔记内容', 'error');
      btnSync.disabled = false;
      btnSync.textContent = '开始同步';
      return;
    }

    // Step 3: 去重合并到现有笔记
    const existingIds = new Set(allNotes.map(n => n.id));
    let added = 0;
    imported.forEach(n => {
      if (!existingIds.has(n.id)) {
        allNotes.push(n);
        existingIds.add(n.id);
        added++;
      }
    });

    // 更新排除列表
    const bookSet = new Set(allNotes.map(n => n.book).filter(Boolean));
    excludeBooks = excludeBooks.filter(b => bookSet.has(b));

    await saveData();

    updateSyncProgress(100, '同步完成！');
    showSyncResult(
      `✅ 同步成功！新增 ${added} 条笔记（跳过 ${imported.length - added} 条重复），来自 ${books.length} 本书。当前共 ${allNotes.length} 条笔记。`,
      'success'
    );
    refreshUI();

  } catch (err) {
    console.error('同步失败:', err);
    showSyncResult('❌ 同步失败：' + err.message, 'error');
  }

  btnSync.disabled = false;
  btnSync.textContent = '开始同步';
  // 5秒后自动隐藏进度条
  setTimeout(() => { syncProgress.style.display = 'none'; }, 5000);
}

// ---- Events: Sync ----

btnSync.addEventListener('click', syncFromWeRead);

// 保存 API Key 到 storage（输入即存）
apiKeyInput.addEventListener('change', async () => {
  await saveApiKey(apiKeyInput.value.trim());
});

// ---- Start ----
init();

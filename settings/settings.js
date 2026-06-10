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
let excludeDocs = [];
let aiExcludeBooks = [];
let aiExcludeDocs = [];

// ---- DOM refs ----
const bookList      = document.getElementById('bookList');
const docList       = document.getElementById('docList');
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
    chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY, API_KEY_STORAGE, 'wx_md_sources'], (result) => {
      resolve(result);
    });
  });
}

async function saveData() {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      [STORAGE_KEY]: allNotes,
      [SETTINGS_KEY]: { excludedBooks: excludeBooks, excludedDocs: excludeDocs, aiExcludeBooks: aiExcludeBooks, aiExcludeDocs: aiExcludeDocs },
      [API_KEY_STORAGE]: apiKeyInput ? apiKeyInput.value.trim() : '',
    }, resolve);
  });
}

async function saveApiKey(key) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [API_KEY_STORAGE]: key }, resolve);
  });
}

// ---- Build book list ----
function buildBookList() {
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

  const dispExclude = new Set(excludeBooks);
  const aiExclude = new Set(aiExcludeBooks);
  let html = '';
  books.forEach(book => {
    const dispOff = dispExclude.has(book);
    const aiOff = aiExclude.has(book);
    html += `
      <div class="book-item">
        <div class="book-info">
          <span class="book-name">《${escapeHTML(book)}》</span>
          <span class="book-note-count">${bookCounts[book]} 条笔记</span>
        </div>
        <div class="toggle-col">
          <label class="toggle">
            <input type="checkbox" class="book-toggle" data-book="${escapeHTML(book)}" ${dispOff ? '' : 'checked'} />
            <span class="slider"></span>
          </label>
        </div>
        <div class="toggle-col ai">
          <label class="toggle toggle-ai">
            <input type="checkbox" class="book-toggle-ai" data-book="${escapeHTML(book)}" ${aiOff ? '' : 'checked'} />
            <span class="slider"></span>
          </label>
        </div>
      </div>
    `;
  });
  bookList.innerHTML = html;

  document.querySelectorAll('.book-toggle').forEach(el => {
    el.addEventListener('change', async (e) => {
      const book = e.target.dataset.book;
      if (e.target.checked) {
        excludeBooks = excludeBooks.filter(b => b !== book);
      } else {
        if (!excludeBooks.includes(book)) excludeBooks.push(book);
      }
      await saveData();
      updateStats();
      showToast(e.target.checked ? '已取消排除《' + book + '》' : '已排除《' + book + '》');
    });
  });

  document.querySelectorAll('.book-toggle-ai').forEach(el => {
    el.addEventListener('change', async (e) => {
      const book = e.target.dataset.book;
      if (e.target.checked) {
        aiExcludeBooks = aiExcludeBooks.filter(b => b !== book);
      } else {
        if (!aiExcludeBooks.includes(book)) aiExcludeBooks.push(book);
      }
      await saveData();
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

  // 导入统计
  const mdFilesEl = document.getElementById('statMdFiles');
  const mdNotesEl = document.getElementById('statMdNotes');
  const reviewCorrectEl = document.getElementById('statReviewCorrect');
  const reviewTotalEl = document.getElementById('statReviewTotal');
  if (mdFilesEl || mdNotesEl) {
    chrome.storage.local.get(['wx_md_sources'], function(data) {
      const sources = data.wx_md_sources || [];
      let totalFiles = 0, totalNotes = 0;
      sources.forEach(function(s) { totalFiles += s.fileCount || 0; totalNotes += s.noteCount || 0; });
      if (mdFilesEl) mdFilesEl.textContent = totalFiles;
      if (mdNotesEl) mdNotesEl.textContent = totalNotes;
    });
  }
  if (reviewCorrectEl || reviewTotalEl) {
    chrome.storage.local.get(['wx_review_stats'], function(data) {
      const s = data.wx_review_stats || {};
      if (reviewCorrectEl) reviewCorrectEl.textContent = s.todayCorrect || 0;
      if (reviewTotalEl) reviewTotalEl.textContent = s.todayTotal || 0;
    });
  }
}

// ---- Build doc list ----
function buildDocList() {
  if (!docList) return;
  const mdNotes = allNotes.filter(n => n.source === 'markdown' && n.filePath);
  const docMap = {};
  mdNotes.forEach(n => {
    const key = n.filePath;
    if (!docMap[key]) docMap[key] = { path: key, fileCount: 0 };
    docMap[key].fileCount++;
  });
  const docs = Object.values(docMap).sort((a, b) => a.path.localeCompare(b.path));

  if (!docs.length) {
    docList.innerHTML = '<p class="no-data">暂未导入 Markdown 文档。</p>';
    return;
  }

  const dispExclude = new Set(excludeDocs);
  const aiExclude = new Set(aiExcludeDocs);
  let html = '';
  docs.forEach(doc => {
    const dispOff = dispExclude.has(doc.path);
    const aiOff = aiExclude.has(doc.path);
    html += `
      <div class="book-item">
        <div class="book-info">
          <span class="book-name">${escapeHTML(doc.path)}</span>
          <span class="book-note-count">${doc.fileCount} 条笔记</span>
        </div>
        <div class="toggle-col">
          <label class="toggle">
            <input type="checkbox" class="doc-toggle" data-doc="${escapeHTML(doc.path)}" ${dispOff ? '' : 'checked'} />
            <span class="slider"></span>
          </label>
        </div>
        <div class="toggle-col ai">
          <label class="toggle toggle-ai">
            <input type="checkbox" class="doc-toggle-ai" data-doc="${escapeHTML(doc.path)}" ${aiOff ? '' : 'checked'} />
            <span class="slider"></span>
          </label>
        </div>
      </div>
    `;
  });
  docList.innerHTML = html;

  document.querySelectorAll('.doc-toggle').forEach(el => {
    el.addEventListener('change', async (e) => {
      const doc = e.target.dataset.doc;
      if (e.target.checked) {
        excludeDocs = excludeDocs.filter(d => d !== doc);
      } else {
        if (!excludeDocs.includes(doc)) excludeDocs.push(doc);
      }
      await saveData();
      updateStats();
    });
  });

  document.querySelectorAll('.doc-toggle-ai').forEach(el => {
    el.addEventListener('change', async (e) => {
      const doc = e.target.dataset.doc;
      if (e.target.checked) {
        aiExcludeDocs = aiExcludeDocs.filter(d => d !== doc);
      } else {
        if (!aiExcludeDocs.includes(doc)) aiExcludeDocs.push(doc);
      }
      await saveData();
    });
  });
}

// ---- Refresh entire UI ----
function refreshUI() {
  buildBookList();
  buildDocList();
  updateStats();
}

// ---- Init ----
async function init() {
  try {
    const data = await loadData();
    allNotes = data[STORAGE_KEY] || [];
    const settings = data[SETTINGS_KEY] || {};
    excludeBooks = settings.excludedBooks || [];
    excludeDocs = settings.excludedDocs || [];
    aiExcludeBooks = settings.aiExcludeBooks || [];
    aiExcludeDocs = settings.aiExcludeDocs || [];
    // 恢复已保存的 API Key
    if (data[API_KEY_STORAGE] && apiKeyInput) {
      apiKeyInput.value = data[API_KEY_STORAGE];
    }
    refreshUI();
    initSourceManagement(data);
    initLogViewer();
    initCacheSettings();
    initMasterToggles();
  } catch (err) {
    console.error('微信书摘: 加载数据失败', err);
    showToast('❌ 加载数据失败：' + err.message);
  }
}

// ---- Events ----

// 清空数据
btnClearAll.addEventListener('click', () => {
  if (allNotes.length === 0) {
    showToast('⚠️ 没有数据可清空');
    return;
  }
  if (confirm('确定要清空所有笔记数据吗？此操作不可撤销！')) {
    allNotes = [];
    excludeBooks = [];
    excludeDocs = [];
    aiExcludeBooks = [];
    aiExcludeDocs = [];
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

/* ============================================
   新增：数据源管理
   ============================================ */
function initSourceManagement(data) {
  const mdSources = data['wx_md_sources'] || [];
  const wereadMeta = document.getElementById('sourceMetaWeread');
  if (!wereadMeta) return;

  const wereadNotes = allNotes.filter(function(n) { return n.source !== 'markdown'; });
  const wereadBooks = new Set(wereadNotes.map(function(n) { return n.book; }).filter(Boolean));
  wereadMeta.textContent = wereadNotes.length + ' 条笔记 · ' + wereadBooks.size + ' 本书';

  const sourceList = document.getElementById('sourceList');
  mdSources.forEach(function(src) {
    const div = document.createElement('div');
    div.className = 'source-item';
    div.innerHTML = '<span class="source-icon">📁</span><div class="source-info"><div class="source-name">' + escapeHTML(src.name) + '</div><div class="source-meta">' + src.fileCount + ' 个文件 · ' + src.noteCount + ' 条笔记</div></div><div style="display:flex;align-items:center;gap:6px;"><button class="btn btn-small" data-delname="' + escapeHTML(src.name) + '" style="color:var(--danger);padding:2px 8px;font-size:11px;border-color:transparent;">🗑️</button><label class="toggle"><input type="checkbox" class="source-toggle" data-source="md_' + escapeHTML(src.name) + '" checked /><span class="slider"></span></label></div>';
    sourceList.appendChild(div);
  });

  document.querySelectorAll('.source-toggle').forEach(function(el) {
    el.addEventListener('change', updateSourceIndicator);
  });
  // 删除来源按钮
  document.querySelectorAll('[data-delname]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var name = btn.dataset.delname;
      if (!confirm('确定要删除来源「' + name + '」的全部笔记吗？此操作不可撤销！')) return;
      deleteSource(name, btn);
    });
  });
  updateSourceIndicator();
}

function deleteSource(name, btn) {
  var origText = btn.textContent;
  btn.textContent = '⏳';
  btn.disabled = true;

  chrome.storage.local.get(['wx_notes', 'wx_md_sources'], function(data) {
    var notes;
    var sourceKey;
    if (name === '微信读书') {
      // 删除所有非 markdown 的笔记
      notes = (data.wx_notes || []).filter(function(n) { return n.source === 'markdown'; });
      sourceKey = 'weread';
    } else {
      // 删除该 MD 来源的笔记
      notes = (data.wx_notes || []).filter(function(n) { return !(n.source === 'markdown' && n.book === name); });
      sourceKey = 'md_' + name;
    }
    // 删除来源记录
    var sources = (data.wx_md_sources || []).filter(function(s) { return s.name !== name; });

    chrome.storage.local.set({ wx_notes: notes, wx_md_sources: sources }, function() {
      allNotes = notes;
      // 从 DOM 移除该行
      var item = btn.closest('.source-item');
      if (item) item.remove();
      // 同步清除该来源的 sourceEnabled 记录
      chrome.storage.local.get(['wx_source_enabled'], function(d) {
        var en = d.wx_source_enabled || {};
        delete en[sourceKey];
        chrome.storage.local.set({ wx_source_enabled: en });
      });
      refreshUI();
      showToast('✅ 已删除来源「' + name + '」');
    });
  });
}

function updateSourceIndicator() {
  const el = document.getElementById('sourceIndicator');
  if (!el) return;
  const toggles = document.querySelectorAll('.source-toggle');
  let enabledCount = 0;
  toggles.forEach(function(t) { if (t.checked) enabledCount++; });
  if (enabledCount === 0) {
    el.textContent = '⚠️ 所有数据源均已关闭，新标签页将无内容可展示';
    el.style.background = 'var(--danger-bg)';
    el.style.color = 'var(--danger)';
  } else if (enabledCount === toggles.length) {
    el.textContent = '🔄 ' + toggles.length + ' 个数据源均已开启，随机从所有笔记中抽取';
    el.style.background = 'var(--accent-subtle)';
    el.style.color = 'var(--accent-hover)';
  } else {
    el.textContent = '🔄 当前 ' + enabledCount + '/' + toggles.length + ' 个数据源开启';
    el.style.background = '#faf9f6';
    el.style.color = 'var(--text-secondary)';
  }
  el.classList.add('show');

  const enabled = {};
  toggles.forEach(function(t) { enabled[t.dataset.source] = t.checked; });
  chrome.storage.local.set({ wx_source_enabled: enabled });
}

/* ============================================
   新增：日志查看器
   ============================================ */
function initLogViewer() {
  const container = document.getElementById('logEntries');
  const btnClear = document.getElementById('btnClearLogs');
  const btnCopy = document.getElementById('btnCopyLogs');
  if (!container || !btnClear) return;

  async function refreshLogs() {
    const logs = await getAiLogs();
    if (!logs.length) {
      container.textContent = '暂无日志';
      return;
    }
    var lines = logs.slice().reverse().slice(0, 200).map(function(log) {
      var ts = (log.ts || '').slice(0, 19).replace('T', ' ');
      var status = log.status === 'ok' ? '✓' : '✗';
      var detail = '';
      if (log.book) detail += ' [' + log.book + ']';
      if (log.detail) detail += ' ' + log.detail;
      if (log.error) detail += ' — ' + log.error;
      if (log.model) detail += ' [' + log.model + ']';
      if (log.ms) detail += ' (' + log.ms + 'ms)';
      if (log.cached) detail += ' → ' + log.cached + ' 条';
      if (log.estTokens) detail += ' ~' + (log.estTokens / 1000).toFixed(1) + 'K tokens';
      return ts + ' [' + log.type + '] ' + status + detail;
    });
    container.textContent = lines.join('\n');
    container.scrollTop = 0;
  }

  document.getElementById('section-logs').addEventListener('toggle', function() {
    if (this.open) refreshLogs();
  });

  btnClear.addEventListener('click', async function() {
    await clearAiLogs();
    refreshLogs();
  });

  if (btnCopy) {
    btnCopy.addEventListener('click', function() {
      var text = container.textContent;
      if (!text || text === '暂无日志') { showToast('⚠️ 暂无日志可复制'); return; }
      navigator.clipboard.writeText(text).then(function() {
        showToast('✅ 日志已复制到剪贴板');
      }).catch(function() {
        showToast('❌ 复制失败');
      });
    });
  }
}

/* ============================================
   新增：缓存设置
   ============================================ */
function initCacheSettings() {
  const cacheCount = document.getElementById('cacheCount');
  const cacheDec = document.getElementById('cacheDec');
  const cacheInc = document.getElementById('cacheInc');
  if (!cacheCount) return;

  chrome.storage.local.get(['wx_cache_size'], function(data) {
    if (data.wx_cache_size) cacheCount.textContent = data.wx_cache_size;
  });

  cacheDec.addEventListener('click', function() {
    var v = parseInt(cacheCount.textContent) - 1;
    if (v < 5) v = 5;
    cacheCount.textContent = v;
    chrome.storage.local.set({ wx_cache_size: v });
  });

  cacheInc.addEventListener('click', function() {
    var v = parseInt(cacheCount.textContent) + 1;
    if (v > 200) v = 200;
    cacheCount.textContent = v;
    chrome.storage.local.set({ wx_cache_size: v });
  });

  // 生成缓存按钮
  var genBtn = document.getElementById('btnGenCache');
  var stopBtn = document.getElementById('btnStopCache');
  if (genBtn) {
    genBtn.addEventListener('click', async function() {
      // 重置停止按钮状态
      stopBtn.disabled = false;
      stopBtn.textContent = '⏹ 停止';
      genBtn.style.display = 'none';
      stopBtn.style.display = 'inline-flex';

      var progress = document.getElementById('genProgress');
      var fill = document.getElementById('genProgressFill');
      var text = document.getElementById('genProgressText');
      progress.style.display = 'block';
      fill.style.width = '0%';
      text.textContent = '准备中...';

      try {
        var result = await window.runAIPipeline(function(current, total, bookName) {
          var pct = Math.round((current / total) * 100);
          fill.style.width = pct + '%';
          text.textContent = '[' + current + '/' + total + '] ' + (bookName || '处理中...');
        });

        if (result && result.cancelled) {
          text.textContent = '⏹ 已停止（处理了 ' + result.cached + ' 条）';
          showToast('⏹ 已停止');
        } else {
          fill.style.width = '100%';
          text.textContent = '✅ 完成！共 ' + result.cached + ' 条缓存';
          showToast('✅ 缓存生成完成：' + result.cached + ' 条');
        }

        var logsEl = document.getElementById('logEntries');
        if (logsEl) {
          var logs = await getAiLogs();
          var lines = logs.slice().reverse().slice(0, 200).map(function(log) {
            var ts = (log.ts || '').slice(0, 19).replace('T', ' ');
            var status = log.status === 'ok' ? '✓' : '✗';
            var detail = '';
            if (log.book) detail += ' [' + log.book + ']';
            if (log.detail) detail += ' ' + log.detail;
            if (log.error) detail += ' — ' + log.error;
            if (log.model) detail += ' [' + log.model + ']';
            if (log.ms) detail += ' (' + log.ms + 'ms)';
            if (log.cached) detail += ' → ' + log.cached + ' 条';
            if (log.estTokens) detail += ' ~' + (log.estTokens / 1000).toFixed(1) + 'K tokens';
            return ts + ' [' + log.type + '] ' + status + detail;
          });
          logsEl.textContent = lines.join('\n');
        }
        refreshCacheStatus();
      } catch (e) {
        fill.style.width = '0%';
        text.textContent = '❌ 失败：' + e.message;
        showToast('❌ ' + e.message);
        refreshCacheStatus();
      }
      genBtn.style.display = 'inline-flex';
      stopBtn.style.display = 'none';
      stopBtn.disabled = false;
      stopBtn.textContent = '⏹ 停止';
      setTimeout(function() { progress.style.display = 'none'; }, 5000);
    });

    stopBtn.addEventListener('click', function() {
      window.cancelAIPipeline();
      stopBtn.disabled = true;
      stopBtn.textContent = '⏹ 正在停止...';
    });

    // 结构化提取按钮
    var structBtn = document.getElementById('btnStructExtract');
    if (structBtn) {
      structBtn.addEventListener('click', async function() {
        structBtn.disabled = true;
        structBtn.textContent = '⏳ 提取中...';
        var progress = document.getElementById('genProgress');
        var fill = document.getElementById('genProgressFill');
        var text = document.getElementById('genProgressText');
        progress.style.display = 'block';
        fill.style.width = '0%';
        text.textContent = '准备中...';
        try {
          var result = await window.runStructuredExtraction(function(current, total, name) {
            var pct = Math.round((current / total) * 100);
            fill.style.width = pct + '%';
            text.textContent = '[' + current + '/' + total + '] ' + (name || '');
          });
          fill.style.width = '100%';
          text.textContent = '✅ 提取完成：' + result.cached + ' 条';
          showToast('✅ 结构化提取完成：' + result.cached + ' 条');
          refreshCacheStatus();
        } catch (e) {
          text.textContent = '❌ ' + e.message;
          showToast('❌ ' + e.message);
        }
        structBtn.disabled = false;
        structBtn.textContent = '📋 结构化提取';
        setTimeout(function() { progress.style.display = 'none'; }, 5000);
      });
    }

    // 生成/停止后刷新缓存状态
    refreshCacheStatus();
    // 监听存储变化自动刷新
    chrome.storage.onChanged.addListener(function(changes) {
      if (changes.wx_ai_cache) refreshCacheStatus();
    });
  }
}

// 刷新缓存状态显示
function refreshCacheStatus() {
  var el = document.getElementById('cacheStatus');
  if (!el) return;
  chrome.storage.local.get(['wx_ai_cache', 'wx_cache_size'], function(data) {
    var cache = data.wx_ai_cache || [];
    var size = data.wx_cache_size || 20;
    var knowledgeCount = cache.filter(function(i) { return i.type === 'knowledge'; }).length;
    var qaCount = cache.filter(function(i) { return i.type === 'qa'; }).length;
    var choiceCount = cache.filter(function(i) { return i.type === 'choice'; }).length;
    var total = cache.length;
    if (total === 0) {
      el.textContent = '暂无缓存';
      el.style.color = 'var(--text-tertiary)';
    } else {
      el.innerHTML = total + ' 条（知识点 ' + knowledgeCount + ' · 问答 ' + qaCount + ' · 选择题 ' + choiceCount + '）';
      el.style.color = 'var(--accent)';
    }
  });
}

/* ============================================
   新增：主开关
   ============================================ */
function initMasterToggles() {
  // AI master toggles
  ['masterAiBook', 'masterAiDoc'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function() {
      var checked = el.checked;
      var selector = id === 'masterAiBook' ? '.book-toggle-ai' : '.doc-toggle-ai';
      document.querySelectorAll(selector).forEach(function(t) {
        t.checked = checked;
        t.dispatchEvent(new Event('change'));
      });
    });
  });
  // Display master toggles
  ['masterDisplayBook', 'masterDisplayDoc'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function() {
      var checked = el.checked;
      var selector = id === 'masterDisplayBook' ? '.book-toggle' : '.doc-toggle';
      document.querySelectorAll(selector).forEach(function(t) {
        t.checked = checked;
        t.dispatchEvent(new Event('change'));
      });
    });
  });
}

// ---- Start ----
init();

/* ============================================
   微信书摘 · 设置 — Markdown 文件夹导入
   ============================================ */
const NOTES_KEY = 'wx_notes';
const MD_SOURCES_KEY = 'wx_md_sources';

async function getMdSources() {
  return new Promise(resolve => {
    chrome.storage.local.get([MD_SOURCES_KEY], r => resolve(r[MD_SOURCES_KEY] || []));
  });
}

async function saveMdSources(sources) {
  return new Promise(resolve => chrome.storage.local.set({ [MD_SOURCES_KEY]: sources }, resolve));
}

function initMarkdownImport() {
  const picker = document.getElementById('folderPicker');
  const result = document.getElementById('mdImportResult');
  if (!picker || !result) return;

  picker.addEventListener('click', async () => {
    result.style.display = 'none';
    try {
      if (!window.showDirectoryPicker) {
        result.className = 'import-result error';
        result.style.display = 'block';
        result.textContent = '当前浏览器不支持选择文件夹功能，请使用最新版 Chrome。';
        return;
      }

      const dirHandle = await window.showDirectoryPicker();
      result.className = 'import-result';
      result.style.display = 'block';
      result.style.background = 'var(--bg)';
      result.style.color = 'var(--text-secondary)';
      result.textContent = '正在扫描文件夹...';

      const mdFiles = [];
      await collectMdFiles(dirHandle, mdFiles, '');

      if (mdFiles.length === 0) {
        result.className = 'import-result error';
        result.textContent = '该文件夹中没有找到 .md 文件。';
        return;
      }

      result.textContent = '找到 ' + mdFiles.length + ' 个 Markdown 文件，正在解析...';

      const notes = [];
      for (const fileEntry of mdFiles) {
        try {
          const content = await fileEntry.text();
          let body = content;
          if (body.startsWith('---')) {
            const end = body.indexOf('---', 3);
            if (end !== -1) body = body.slice(end + 3);
          }
          body = body.trim();
          if (!body) continue;
          notes.push({
            id: 'md_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            content: body,
            book: dirHandle.name,
            source: 'markdown',
            filePath: fileEntry.relativePath || fileEntry.name,
            createTime: new Date().toISOString().split('T')[0]
          });
        } catch (e) {
          console.warn('解析失败:', fileEntry.name, e);
        }
      }

      const existing = await new Promise(resolve => {
        chrome.storage.local.get([NOTES_KEY], r => resolve(r[NOTES_KEY] || []));
      });
      const existingIds = new Set(existing.map(n => n.id));
      let added = 0;
      notes.forEach(n => {
        if (!existingIds.has(n.id)) {
          existing.push(n);
          existingIds.add(n.id);
          added++;
        }
      });
      await new Promise(resolve => chrome.storage.local.set({ [NOTES_KEY]: existing }, resolve));

      const sources = await getMdSources();
      const sourceInfo = {
        name: dirHandle.name,
        path: dirHandle.name,
        fileCount: mdFiles.length,
        noteCount: notes.length,
        importedAt: new Date().toISOString()
      };
      const existingIdx = sources.findIndex(s => s.name === dirHandle.name);
      if (existingIdx >= 0) sources[existingIdx] = sourceInfo;
      else sources.push(sourceInfo);
      await saveMdSources(sources);

      result.className = 'import-result success';
      result.innerHTML = '导入成功<br>文件夹：<code>' + dirHandle.name + '</code><br>扫描到 <strong>' + mdFiles.length + '</strong> 个文件，新增 <strong>' + added + '</strong> 条笔记。';
    } catch (e) {
      if (e.name === 'AbortError' || e.name === 'SecurityError') { result.style.display = 'none'; return; }
      result.className = 'import-result error';
      result.textContent = '导入失败：' + e.message;
    }
  });
}

async function collectMdFiles(dirHandle, files, parentPath) {
  for await (const entry of dirHandle.values()) {
    const path = parentPath ? parentPath + '/' + entry.name : entry.name;
    if (entry.kind === 'directory') {
      if (entry.name.startsWith('.')) continue;
      await collectMdFiles(entry, files, path);
    } else if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md')) {
      const file = await entry.getFile();
      file.relativePath = path;
      files.push(file);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMarkdownImport);
} else {
  initMarkdownImport();
}

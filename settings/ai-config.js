/* ============================================
   微信书摘 · 设置 — AI 接口配置
   ============================================ */
const AI_CONFIG_KEY = 'wx_ai_config';
const AI_LOG_KEY = 'wx_ai_log';

async function loadAiConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get([AI_CONFIG_KEY], result => {
      resolve(result[AI_CONFIG_KEY] || null);
    });
  });
}

async function saveAiConfig(config) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [AI_CONFIG_KEY]: config }, resolve);
  });
}

async function addAiLog(entry) {
  const data = await new Promise(resolve => {
    chrome.storage.local.get([AI_LOG_KEY], r => resolve(r[AI_LOG_KEY] || []));
  });
  data.push({ ts: new Date().toISOString(), ...entry });
  if (data.length > 200) data.splice(0, data.length - 200);
  await new Promise(resolve => chrome.storage.local.set({ [AI_LOG_KEY]: data }, resolve));
  return data;
}

async function getAiLogs() {
  return new Promise(resolve => {
    chrome.storage.local.get([AI_LOG_KEY], r => resolve(r[AI_LOG_KEY] || []));
  });
}

async function clearAiLogs() {
  return new Promise(resolve => chrome.storage.local.set({ [AI_LOG_KEY]: [] }, resolve));
}

function initAiConfig() {
  const endpoint = document.getElementById('aiEndpoint');
  const apiKey = document.getElementById('aiApiKey');
  const model = document.getElementById('aiModel');
  const btnPing = document.getElementById('btnPing');
  const btnTest = document.getElementById('btnTestAi');
  const endpointDot = document.getElementById('endpointDot');
  const endpointText = document.getElementById('endpointText');
  const testDot = document.getElementById('testDot');
  const testText = document.getElementById('testText');
  const testResult = document.getElementById('aiTestResult');

  loadAiConfig().then(cfg => {
    if (cfg) {
      if (cfg.endpoint) endpoint.value = cfg.endpoint;
      if (cfg.apiKey) apiKey.value = cfg.apiKey;
      if (cfg.model) model.value = cfg.model;
    }
  });

  function setEndpointStatus(type, msg) {
    endpointDot.className = 'status-dot ' + type;
    endpointText.className = 'status-text ' + type;
    endpointText.textContent = msg;
  }

  function setTestStatus(type, msg) {
    testDot.className = 'status-dot ' + type;
    testText.className = 'status-text ' + type;
    testText.textContent = msg;
  }

  btnPing.addEventListener('click', async () => {
    const url = endpoint.value.trim();
    if (!url) { setEndpointStatus('idle', '请输入端点 URL'); return; }
    setEndpointStatus('idle', '正在测试连接...');
    try {
      const start = Date.now();
      const res = await fetch(url, { method: 'OPTIONS', mode: 'cors' });
      const ms = Date.now() - start;
      setEndpointStatus('success', '端点连接成功 (' + ms + 'ms)');
      await addAiLog({ type: 'ping', status: 'ok', url: url, ms: ms });
    } catch (e) {
      setEndpointStatus('error', '连接失败：' + e.message);
      await addAiLog({ type: 'ping', status: 'error', url: url, error: e.message });
    }
  });

  btnTest.addEventListener('click', async () => {
    const url = endpoint.value.trim();
    const key = apiKey.value.trim();
    const m = model.value.trim();
    if (!url || !key || !m) {
      setTestStatus('idle', '请完整填写端点、API Key 和模型名');
      return;
    }
    setTestStatus('idle', '正在测试...');
    testResult.style.display = 'none';
    try {
      const start = Date.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: m, messages: [{ role: 'user', content: '你好，请回复"OK"测试连通性。' }], max_tokens: 20 })
      });
      const ms = Date.now() - start;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error('HTTP ' + res.status + ': ' + text.slice(0, 150));
      }
      const data = await res.json();
      setTestStatus('success', '测试通过');
      testResult.className = 'import-result success';
      testResult.style.display = 'block';
      testResult.innerHTML = '测试成功<br>模型名：<code>' + m + '</code><br>响应耗时：<code>' + ms + 'ms</code>';
      await addAiLog({ type: 'test', status: 'ok', model: m, ms: ms });
    } catch (e) {
      setTestStatus('error', '测试失败');
      testResult.className = 'import-result error';
      testResult.style.display = 'block';
      testResult.innerHTML = '测试失败<br>错误：<code>' + e.message + '</code>';
      await addAiLog({ type: 'test', status: 'error', model: m, error: e.message });
    }
  });

  ['change', 'input'].forEach(ev => {
    [endpoint, apiKey, model].forEach(el => {
      el.addEventListener(ev, () => {
        saveAiConfig({ endpoint: endpoint.value.trim(), apiKey: apiKey.value.trim(), model: model.value.trim() });
      });
    });
  });
}

/* ============================================
   AI 管线：批量处理笔记 → 生成缓存
   ============================================ */

// 调用 DeepSeek API
async function callAI(promptText, systemPrompt) {
  var cfg = await loadAiConfig();
  if (!cfg || !cfg.endpoint || !cfg.apiKey || !cfg.model) {
    throw new Error('AI 接口未配置完整');
  }
  var res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + cfg.apiKey
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: systemPrompt || '你是一个知识提取助手。请用中文回答。' },
        { role: 'user', content: promptText }
      ],
      max_tokens: 300,
      temperature: 0.3
    })
  });
  if (!res.ok) {
    var text = await res.text().catch(function() { return ''; });
    throw new Error('HTTP ' + res.status + ': ' + text.slice(0, 200));
  }
  var data = await res.json();
  return data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '';
}

// 处理单条笔记
async function processNote(note) {
  var prompt = '请根据以下笔记内容，提取一个知识点，并以JSON格式返回（只返回JSON，不要其他文字）：\n';
  prompt += '{\n  "summary": "一句话摘要（50字以内）",\n';
  prompt += '  "qa": { "question": "关于此知识点的思考题", "answer": "答案" },\n';
  prompt += '  "choice": { "question": "关于此知识点的选择题题干", "options": ["A选项", "B选项", "C选项", "D选项"], "correct": 0 }\n}\n\n';
  prompt += '笔记内容（可能较长，只提取对生成题目有用的关键信息即可）：\n' + (note.content || '');

  var reply = await callAI(prompt, '你是一个知识提取助手。只返回JSON，不要任何其他文字。JSON必须包含summary、qa、choice三个字段。');
  // 尝试提取 JSON
  var jsonMatch = reply.match(/\{[\s\S]*\}/);
  if (jsonMatch) reply = jsonMatch[0];
  var parsed;
  try {
    parsed = JSON.parse(reply);
  } catch (e) {
    throw new Error('AI 返回非 JSON：' + reply.slice(0, 100));
  }
  return {
    summary: parsed.summary || '',
    qa: parsed.qa || { question: '', answer: '' },
    choice: parsed.choice || { question: '', options: [], correct: 0 }
  };
}

// 批量处理，填充缓存
// 取消标记：设为 true 可停止管线
var _pipelineCancelled = false;

// onProgress：回调函数 function(current, total, currentNote)
async function runAIPipeline(onProgress) {
  _pipelineCancelled = false;

  var allData = await new Promise(function(resolve) {
    chrome.storage.local.get(['wx_notes', 'wx_settings', 'wx_source_enabled'], function(r) { resolve(r); });
  });
  var notes = allData.wx_notes || [];
  if (!notes.length) throw new Error('没有笔记可供处理');

  // 过滤已排除书籍 + 排除文档
  var settings = allData.wx_settings || {};
  var excludeBooks = settings.excludedBooks || [];
  var excludeSet = new Set(excludeBooks.map(function(b) { return b.toLowerCase().trim(); }));
  var excludeDocs = settings.excludedDocs || [];
  var docSet = new Set(excludeDocs);

  var candidates = notes.filter(function(n) {
    if (excludeSet.has((n.book || '').toLowerCase().trim())) return false;
    if (n.source === 'markdown' && docSet.has(n.filePath)) return false;
    return true;
  });
  if (!candidates.length) throw new Error('没有可处理的笔记（可能已被排除）');

  // 按数据源开关过滤
  var srcEnabled = allData.wx_source_enabled || {};
  var srcKeys = Object.keys(srcEnabled);
  if (srcKeys.length > 0) {
    var enabledSources = srcKeys.filter(function(k) { return srcEnabled[k]; });
    if (enabledSources.length > 0) {
      candidates = candidates.filter(function(n) {
        var src = n.source || 'weread';
        return enabledSources.some(function(s) {
          if (s === 'weread' && src === 'weread') return true;
          if (s.startsWith('md_') && src === 'markdown') return true;
          return false;
        });
      });
    }
  }
  if (!candidates.length) throw new Error('已开启的数据源中没有可处理的笔记');

  // 取缓存大小
  var size = await new Promise(function(resolve) {
    chrome.storage.local.get(['wx_cache_size'], function(r) { resolve(r.wx_cache_size || 20); });
  });

  // 随机抽 size 条
  var shuffled = candidates.slice().sort(function() { return Math.random() - 0.5; });
  var batch = shuffled.slice(0, size);

  // 估算 token（~1.5 tokens/中文字符）
  var totalChars = batch.reduce(function(sum, n) { return sum + (n.content || '').length; }, 0);
  var estTokens = Math.round(totalChars * 1.5);
  await addAiLog({ type: 'pipeline', status: 'start', total: batch.length, estTokens: estTokens });

  for (var i = 0; i < batch.length; i++) {
    if (_pipelineCancelled) {
      await addAiLog({ type: 'pipeline', status: 'cancelled', total: batch.length, processed: i });
      return { total: batch.length, cached: results.length, cancelled: true };
    }
    try {
      var note = batch[i];
      if (onProgress) onProgress(i + 1, batch.length, note.book || note.id.slice(0, 8));
      var processed = await processNote(note);
      // 出处信息
      var sourceParts = [];
      if (note.book) sourceParts.push('《' + note.book + '》');
      if (note.author) sourceParts.push(note.author);
      if (note.chapter) sourceParts.push(note.chapter);
      if (!note.book && note.filePath) sourceParts.push(note.filePath);
      var sourceStr = sourceParts.join(' · ') || '';
      var srcType = note.source || 'weread'; // 'weread' or 'markdown'

      var entry = {
        type: 'summary',
        sourceNoteId: note.id,
        srcType: srcType,
        data: { summary: processed.summary, source: sourceStr }
      };
      results.push(entry);
      // Q&A
      if (processed.qa && processed.qa.question) {
        results.push({
          type: 'qa',
          sourceNoteId: note.id,
          srcType: srcType,
          data: { question: processed.qa.question, answer: processed.qa.answer, source: sourceStr }
        });
      }
      // Choice
      if (processed.choice && processed.choice.question && processed.choice.options.length >= 2) {
        results.push({
          type: 'choice',
          sourceNoteId: note.id,
          srcType: srcType,
          data: {
            question: processed.choice.question,
            source: sourceStr,
            options: processed.choice.options.map(function(opt, idx) {
              return { label: opt, correct: idx === processed.choice.correct };
            })
          }
        });
      }
      await addAiLog({ type: 'process', status: 'ok', noteId: note.id.slice(0, 16), book: note.book || '' });
    } catch (e) {
      await addAiLog({ type: 'process', status: 'error', noteId: note.id.slice(0, 16), error: e.message });
    }
  }

  // 保存缓存
  await new Promise(function(resolve) {
    chrome.storage.local.set({ wx_ai_cache: results }, resolve);
  });
  await addAiLog({ type: 'pipeline', status: 'done', total: batch.length, cached: results.length, estTokens: estTokens });
  return { total: batch.length, cached: results.length };
}

// 手动触发管线的函数（从设置页调用）
window.runAIPipeline = runAIPipeline;
window.cancelAIPipeline = function() { _pipelineCancelled = true; };

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAiConfig);
} else {
  initAiConfig();
}

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
async function callAI(promptText, systemPrompt, maxOutTokens) {
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
      max_tokens: maxOutTokens || 1000,
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

// 从回复中提取 JSON
function extractJSON(reply) {
  var m = reply.match(/\[[\s\S]*\]/);
  if (m) return JSON.parse(m[0]);
  m = reply.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error('AI 返回非 JSON：' + reply.slice(0, 100));
}

// 处理 WeChat 笔记（已是单个知识点）
async function processWeChatNote(note) {
  var prompt = '请根据以下笔记内容，生成一条精炼摘要和一个问答对、一个选择题，JSON返回（只返回JSON）：\n';
  prompt += '{"summary":"一句话摘要","qa":{"question":"思考题","answer":"答案"},"choice":{"question":"题干","options":["A","B","C","D"],"correct":0}}\n\n';
  prompt += '内容：' + (note.content || '').slice(0, 2000);

  var reply = await callAI(prompt, '你是知识提取助手。只返回JSON。', 1500);
  var parsed = extractJSON(reply);
  return {
    knowledges: [parsed.summary || note.content.slice(0, 200)],
    qa: parsed.qa ? [{ question: parsed.qa.question, answer: parsed.qa.answer }] : [],
    choices: parsed.choice ? [{ question: parsed.choice.question, options: parsed.choice.options, correct: parsed.choice.correct }] : []
  };
}

// 结构化提取：从 Obsidian 笔记直接提取 QA（- [ ] 问题 + > [!tip] 答案）
function extractStructuredQA(note) {
  var content = note.content || '';
  var lines = content.split('\n');
  var qas = [];
  var currentQ = null;
  var inAnswer = false;
  var answerLines = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    // 匹配 - [ ] 或 - [x] 问题行
    var taskMatch = line.match(/^\s*[-*]\s*\[[ x]\]\s*(.*)/);
    if (taskMatch) {
      // 保存上一个 Q&A
      if (currentQ && answerLines.length > 0) {
        qas.push({ question: currentQ, answer: answerLines.join('\n').trim() });
      }
      currentQ = taskMatch[1].trim();
      answerLines = [];
      inAnswer = false;
    } else if (line.match(/^\s*>?\s*\[!tip\]/i) || line.match(/^\s*>?\s*\[!note\]/i) || line.match(/^\s*>?\s*\[!summary\]/i)) {
      inAnswer = true;
    } else if (inAnswer) {
      if (line.trim() === '' || line.startsWith('- [')) {
        // 空行或新任务结束答案块
        inAnswer = false;
      } else {
        // 去掉 > 前缀和 <font> 等格式标签
        var cleaned = line.replace(/^>\s*/, '').replace(/<[^>]+>/g, '').trim();
        if (cleaned) answerLines.push(cleaned);
      }
    }
  }
  // 保存最后一个
  if (currentQ && answerLines.length > 0) {
    qas.push({ question: currentQ, answer: answerLines.join('\n').trim() });
  }

  return qas;
}

// 规则切分 Markdown 文档（浏览模式：不耗 token）
function splitMDDocForBrowse(note) {
  var content = note.content || '';
  var knowledges = [];

  // 1. 按 Obsidian 任务列表切分：- [ ] 或 - [x] 开头的行为一个知识点
  var lines = content.split('\n');
  var current = [];
  var inTask = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var taskMatch = line.match(/^\s*[-*]\s*\[[ x]\]\s*(.*)/);
    if (taskMatch) {
      // 遇到新的任务项，保存上一个
      if (inTask && current.length > 0) {
        knowledges.push(current.join('\n').trim());
      }
      current = [line];
      inTask = true;
    } else if (inTask) {
      // 在任务块内：空行或 #### 标题结束当前块
      if (line.trim() === '' || line.startsWith('####') || line.startsWith('##')) {
        if (current.length > 0) {
          knowledges.push(current.join('\n').trim());
          current = [];
        }
        inTask = false;
        // 标题行作为新段落
        if (line.startsWith('####') || line.startsWith('##')) {
          current = [line];
          inTask = true;
        }
      } else {
        current.push(line);
      }
    } else if (line.startsWith('####') || line.startsWith('##')) {
      // 标题单独成段
      if (current.length > 0) knowledges.push(current.join('\n').trim());
      current = [line];
      inTask = true;
    }
  }
  if (current.length > 0) knowledges.push(current.join('\n').trim());

  // 2. 如果规则切分没分出几条，按段落（空行）切分
  if (knowledges.length < 2) {
    knowledges = content.split(/\n\n+/).map(function(p) { return p.trim(); }).filter(Boolean);
  }

  // 3. 过滤太短的片段（<10字）和太长片段（>5000字）
  knowledges = knowledges.filter(function(k) {
    return k.length >= 10 && k.length <= 5000;
  });

  return knowledges.length > 0 ? knowledges : [(content || '').slice(0, 500)];
}

// 处理 Markdown 文档（用 AI 生成 QA/Choice 题目）
async function processMDDoc(note) {
  var content = (note.content || '').slice(0, 16000);
  var prompt = '你是一个知识提取专家。请阅读以下文档，提取出其中的核心知识点。\n';
  prompt += '每个知识点用1-2句话概括。请以JSON数组格式返回，每个元素包含：\n';
  prompt += '{"knowledge":"知识点内容（精简完整）"}\n\n';
  prompt += '最多提取10个知识点。如果内容少于3段，只提取主要的1-2个即可。\n\n';
  prompt += '文档内容：\n' + content;

  var reply = await callAI(prompt, '你是知识提取专家。只返回JSON数组，不要其他文字。格式：[{"knowledge":"..."},{"knowledge":"..."}]', 2000);
  var parsed = extractJSON(reply);
  if (!Array.isArray(parsed)) throw new Error('AI 未返回数组');

  // 从每个知识点生成QA和选择题（最多各20）
  var knowledges = [], qas = [], choices = [];
  parsed.forEach(function(item) {
    var k = (item.knowledge || '').trim();
    if (k) knowledges.push(k);
  });
  if (!knowledges.length) knowledges = [(note.content || '').slice(0, 200)];

  // 批量从知识点生成题目
  if (knowledges.length > 0) {
    var qPrompt = '根据以下知识点，为每个知识点生成一个问答对和一个四选一选择题。\n';
    qPrompt += 'JSON数组格式：[{"qa":{"question":"问题","answer":"答案"},"choice":{"question":"题干","options":["A","B","C","D"],"correct":0}}]\n\n';
    qPrompt += '知识点列表：\n';
    knowledges.forEach(function(k, i) { qPrompt += (i+1) + '. ' + k + '\n'; });

    try {
      var qReply = await callAI(qPrompt, '只返回JSON数组', 2000);
      var qParsed = extractJSON(qReply);
      if (Array.isArray(qParsed)) {
        qParsed.forEach(function(item) {
          if (item.qa && item.qa.question) qas.push({ question: item.qa.question, answer: item.qa.answer || '' });
          if (item.choice && item.choice.question && item.choice.options) {
            choices.push({ question: item.choice.question, options: item.choice.options, correct: item.choice.correct || 0 });
          }
        });
      }
    } catch (e) {
      // 题目生成失败不阻塞，知识点的储存不受影响
    }
  }

  return { knowledges: knowledges, qa: qas, choices: choices };
}

// 批量处理，填充缓存
// 取消标记：设为 true 可停止管线
var _pipelineCancelled = false;

// onProgress：回调函数 function(current, total, currentNote)
async function runAIPipeline(onProgress) {
  _pipelineCancelled = false;

  var allData = await new Promise(function(resolve) {
    chrome.storage.local.get(['wx_notes', 'wx_settings', 'wx_source_enabled', 'wx_structured_extract', 'wx_skip_excluded_in_ai'], function(r) { resolve(r); });
  });
  var useStructured = allData.wx_structured_extract === true;
  var skipExcluded = allData.wx_skip_excluded_in_ai !== false;
  var notes = allData.wx_notes || [];
  if (!notes.length) throw new Error('没有笔记可供处理');

  // 过滤已排除书籍 + 排除文档
  var settings = allData.wx_settings || {};
  var excludeBooks = settings.excludedBooks || [];
  var excludeSet = new Set(excludeBooks.map(function(b) { return b.toLowerCase().trim(); }));
  var excludeDocs = settings.excludedDocs || [];
  var docSet = new Set(excludeDocs);

  var candidates = notes;
  if (skipExcluded) {
    candidates = notes.filter(function(n) {
      if (excludeSet.has((n.book || '').toLowerCase().trim())) return false;
      if (n.source === 'markdown' && docSet.has(n.filePath)) return false;
      return true;
    });
  }
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
  var results = [];
  await addAiLog({ type: 'pipeline', status: 'start', total: batch.length, estTokens: estTokens });

  for (var i = 0; i < batch.length; i++) {
    if (_pipelineCancelled) {
      await addAiLog({ type: 'pipeline', status: 'cancelled', total: batch.length, processed: i });
      return { total: batch.length, cached: results.length, cancelled: true };
    }
    try {
      var note = batch[i];
      if (onProgress) onProgress(i + 1, batch.length, note.book || note.id.slice(0, 8));
      var srcType = note.source || 'weread';
      // 知识提取：Markdown 用规则切分（不耗 token），WeChat 用 AI
      var knowledges = srcType === 'markdown' ? splitMDDocForBrowse(note) : [note.content || ''];
      // 生成 QA/Choice 题目：结构化提取优先
      var qaItems = [];
      var choiceItems = [];
      if (srcType === 'markdown' && useStructured) {
        // 结构化提取：直接从 - [ ] 任务列表取 QA
        qaItems = extractStructuredQA(note);
        // 选择题需要 AI 生成（或者跳过）
      } else {
        // AI 生成
        var processed = srcType === 'markdown' ? await processMDDoc(note) : await processWeChatNote(note);
        qaItems = processed.qa || [];
        choiceItems = processed.choices || [];
      }

      // 出处信息
      var sourceParts = [];
      if (note.book) sourceParts.push('《' + note.book + '》');
      if (note.author) sourceParts.push(note.author);
      if (note.chapter) sourceParts.push(note.chapter);
      if (!note.book && note.filePath) sourceParts.push(note.filePath);
      var sourceStr = sourceParts.join(' · ') || '';

      // 浏览模式：所有知识点都存（Markdown 用规则拆分，不用 AI）
      knowledges.forEach(function(k) {
        results.push({
          type: 'knowledge',
          sourceNoteId: note.id,
          srcType: srcType,
          data: { content: k, source: sourceStr }
        });
      });

      // Q&A：最多 MAX_QA 条
      qaItems.forEach(function(item) {
        if (qaCount >= MAX_QA) return;
        results.push({ type: 'qa', sourceNoteId: note.id, srcType: srcType, data: { question: item.question, answer: item.answer, source: sourceStr } });
        qaCount++;
      });

      // Choice：最多 MAX_CHOICE 条
      choiceItems.forEach(function(item) {
        if (choiceCount >= MAX_CHOICE) return;
        results.push({
          type: 'choice', sourceNoteId: note.id, srcType: srcType,
          data: { question: item.question, source: sourceStr,
            options: (item.options || []).map(function(opt, idx) { return { label: opt, correct: idx === (item.correct || 0) }; })
          }
        });
        choiceCount++;
      });
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

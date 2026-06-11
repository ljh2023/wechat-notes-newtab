/* ============================================
   微信书摘 · 新标签页 — 问答/选择题模式
   ============================================ */
const REVIEW_STATS_KEY = 'wx_review_stats';
const LEARNING_PROGRESS_KEY = 'wx_learning_progress';

let _currentQuestionBook = null;

// ---- 隐藏所有状态 ----
function hideAllStates() {
  document.querySelectorAll('.state').forEach(function(s) { s.classList.remove('active'); });
}

function getDefaultModeStats(mode) {
  if (mode === 'browse') {
    return { todayDate: '', todaySeen: 0, streakDays: 0 };
  }
  return { todayDate: '', todayCorrect: 0, todayTotal: 0, streakDays: 0, masteryPercent: 0 };
}

async function getReviewStats() {
  return new Promise(resolve => {
    chrome.storage.local.get([REVIEW_STATS_KEY], r => {
      let data = r[REVIEW_STATS_KEY] || {};
      // 从旧格式（扁平）迁移到新格式（按模式嵌套）
      if (data.qa === undefined && data.todayCorrect !== undefined) {
        const migrated = {
          qa: { ...data },
          choice: getDefaultModeStats('choice'),
          browse: getDefaultModeStats('browse')
        };
        chrome.storage.local.set({ [REVIEW_STATS_KEY]: migrated });
        resolve(migrated);
      } else {
        // 确保各模式键都存在
        ['qa', 'choice', 'browse'].forEach(function(m) {
          if (!data[m]) data[m] = getDefaultModeStats(m);
        });
        resolve(data);
      }
    });
  });
}

async function saveReviewStats(stats) {
  return new Promise(resolve => chrome.storage.local.set({ [REVIEW_STATS_KEY]: stats }, resolve));
}

function getModeForReview() {
  return typeof currentMode !== 'undefined' && ['qa', 'choice', 'browse'].indexOf(currentMode) >= 0
    ? currentMode : 'qa';
}

async function getLearningProgress() {
  return new Promise(resolve => {
    chrome.storage.local.get([LEARNING_PROGRESS_KEY], r => {
      resolve(r[LEARNING_PROGRESS_KEY] || {});
    });
  });
}

async function saveLearningProgress(progress) {
  return new Promise(resolve => chrome.storage.local.set({ [LEARNING_PROGRESS_KEY]: progress }, resolve));
}

async function recordAnswer(correct, bookName, mode) {
  mode = mode || getModeForReview();
  // 选择题模式用 choice，其他模式用 qa
  if (mode === 'choice') {/* ok */}
  else if (mode === 'qa') {/* ok */}
  else mode = 'qa'; // fallback

  const stats = await getReviewStats();
  const ms = stats[mode];
  const today = new Date().toISOString().split('T')[0];
  if (ms.todayDate !== today) {
    ms.todayDate = today;
    ms.todayCorrect = 0;
    ms.todayTotal = 0;
  }
  ms.todayTotal++;
  if (correct) ms.todayCorrect++;
  ms.masteryPercent = Math.round((ms.todayCorrect / ms.todayTotal) * 100);
  await saveReviewStats(stats);

  // 按书本追踪答题记录
  if (bookName) {
    const progress = await getLearningProgress();
    const bookKey = '__book_qa__' + bookName;
    if (!progress[bookKey]) {
      progress[bookKey] = { correct: 0, total: 0 };
    }
    progress[bookKey].total++;
    if (correct) progress[bookKey].correct++;
    await saveLearningProgress(progress);
  }
}

// 浏览模式：记录当日浏览的笔记数
async function recordBrowseSeen(count) {
  const stats = await getReviewStats();
  const ms = stats.browse;
  const today = new Date().toISOString().split('T')[0];
  if (ms.todayDate !== today) {
    ms.todayDate = today;
    ms.todaySeen = 0;
  }
  ms.todaySeen += count;
  await saveReviewStats(stats);
}

function renderQAMode(data, onResult) {
  hideAllStates();
  const state = document.getElementById('state-qa');
  if (!state) return;
  state.classList.add('active');

  document.getElementById('qaQuestion').textContent = data.question || '(问题内容不可用)';

  var sourceEl = document.getElementById('qaSource');
  if (sourceEl) {
    sourceEl.innerHTML = data.source ? '📖 ' + data.source : '';
  }
  _currentQuestionBook = data.source || null;

  // 绑定导航按钮
  var nextBtn = document.getElementById('qaNext');
  var prevBtn = document.getElementById('qaPrev');
  if (nextBtn) { nextBtn.onclick = function() { loadNextInMode(true); }; }
  if (prevBtn) { prevBtn.onclick = function() { loadPrevInMode(); }; }

  const showBtn = document.getElementById('qaShowAnswer');
  const answerDiv = document.getElementById('qaAnswer');
  const feedbackDiv = document.getElementById('qaFeedback');

  showBtn.style.display = 'block';
  answerDiv.style.display = 'none';
  feedbackDiv.style.display = 'none';

  showBtn.onclick = () => {
    answerDiv.style.display = 'block';
    answerDiv.textContent = data.answer || '(答案内容不可用)';
    showBtn.style.display = 'none';
    feedbackDiv.style.display = 'block';
    feedbackDiv.innerHTML = '<p style="margin-bottom:8px;">你记住了吗？</p><button class="btn" id="feedbackCorrect" style="margin-right:8px;">记住了</button><button class="btn" id="feedbackWrong">没记住</button>';
    document.getElementById('feedbackCorrect').onclick = async () => {
      await recordAnswer(true, _currentQuestionBook);
      feedbackDiv.innerHTML = '<span style="color:var(--accent);font-weight:600;">太棒了！继续加油！</span>';
      if (onResult) onResult(true);
      if (typeof updateCoverageDisplay === 'function') updateCoverageDisplay();
    };
    document.getElementById('feedbackWrong').onclick = async () => {
      await recordAnswer(false, _currentQuestionBook);
      feedbackDiv.innerHTML = '<span style="color:var(--danger);font-weight:600;">没关系，下次一定！</span>';
      if (onResult) onResult(false);
      if (typeof updateCoverageDisplay === 'function') updateCoverageDisplay();
    };
  };
  // 显示覆盖度面板
  if (typeof updateCoverageDisplay === 'function') updateCoverageDisplay();
}

function renderChoiceMode(data, onResult) {
  hideAllStates();
  const state = document.getElementById('state-choice');
  if (!state) return;
  state.classList.add('active');

  document.getElementById('choiceQuestion').textContent = data.question || '(题目内容不可用)';

  var sourceEl = document.getElementById('choiceSource');
  if (sourceEl) {
    sourceEl.innerHTML = data.source ? '📖 ' + data.source : '';
  }
  _currentQuestionBook = data.source || null;

  // 绑定导航按钮
  var nextBtn = document.getElementById('choiceNext');
  var prevBtn = document.getElementById('choicePrev');
  if (nextBtn) { nextBtn.onclick = function() { loadNextInMode(true); }; }
  if (prevBtn) { prevBtn.onclick = function() { loadPrevInMode(); }; }

  const optionsDiv = document.getElementById('choiceOptions');
  const resultDiv = document.getElementById('choiceResult');
  optionsDiv.innerHTML = '';
  resultDiv.style.display = 'none';

  const options = data.options || [];
  let answered = false;

  options.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.className = 'choice-opt';
    btn.textContent = String.fromCharCode(65 + idx) + '. ' + opt.label;
    btn.onclick = async () => {
      if (answered) return;
      answered = true;
      optionsDiv.querySelectorAll('.choice-opt').forEach(b => b.disabled = true);
      if (opt.correct) {
        btn.classList.add('correct');
        resultDiv.style.display = 'block';
        resultDiv.style.background = 'var(--accent-subtle)';
        resultDiv.style.color = 'var(--accent-hover)';
        resultDiv.innerHTML = '回答正确！';
        await recordAnswer(true, _currentQuestionBook);
        if (onResult) onResult(true);
        if (typeof updateCoverageDisplay === 'function') updateCoverageDisplay();
      } else {
        btn.classList.add('wrong');
        optionsDiv.querySelectorAll('.choice-opt').forEach((b, i) => {
          if (options[i].correct) b.classList.add('correct');
        });
        resultDiv.style.display = 'block';
        resultDiv.style.background = 'var(--danger-bg)';
        resultDiv.style.color = 'var(--danger)';
        resultDiv.textContent = '答错了，正确答案是 ' + String.fromCharCode(65 + options.findIndex(o => o.correct));
        await recordAnswer(false, _currentQuestionBook);
        if (onResult) onResult(false);
        if (typeof updateCoverageDisplay === 'function') updateCoverageDisplay();
      }
    };
    optionsDiv.appendChild(btn);
  });
  // 显示覆盖度面板
  if (typeof updateCoverageDisplay === 'function') updateCoverageDisplay();
}

function showAllOffState() {
  hideAllStates();
  const el = document.getElementById('state-all-off');
  if (el) el.classList.add('active');
  const link = document.getElementById('goToSettingsFromEmpty');
  if (link) {
    link.onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
  }
}

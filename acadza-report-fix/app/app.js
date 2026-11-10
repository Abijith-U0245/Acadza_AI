const state = { reports: [], questions: [], results: [], history: [], activeEdits: new Map() };
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const bodyOf = q => q && (q.scq || q.mcq || q.integerQuestion) || {};
const label = v => (v || '').replaceAll('_', ' ');
const taxonomyFields = {
  spelling: ['question', 'solution'], noise: ['question', 'solution'], exam_reference: ['question', 'solution'],
  markup_leak: ['question', 'solution'], answer_form: ['question'], notation: ['question', 'solution'],
  stem_data: ['question'], option_repair: ['question'], solution_fix: ['solution'], solution_missing: ['solution'],
  answer_key: ['answer', 'solution'], type_mismatch: ['questionType', 'question', 'answer']
};
const facultyOnlyRepairs = new Set(['identical_options', 'diagram', 'wrong_question', 'unsound', 'wrong_chapter', 'syllabus']);
const placeholderPattern = /\[(?:restore|replace|add|insert|provide|fill|write|supply)[^\]]*\]/i;
function renderField(value, field) {
  return field === 'question' || field === 'solution' ? value : esc(value);
}

function sourceValue(question, field) {
  const body = bodyOf(question);
  return field === 'questionType' ? question.questionType : body[field];
}
function validateEdit(result, question) {
  if (!result.edit) return { valid: false, reason: 'No edit supplied.' };
  if (!result.repair) return { valid: false, reason: 'An edit cannot exist without a repair type.' };
  const allowed = taxonomyFields[result.repair];
  if (!allowed) return { valid: false, reason: 'Repair type is not recognized by the loaded taxonomy.' };
  const edit = result.edit;
  if (!allowed.includes(edit.field)) return { valid: false, reason: `Field "${edit.field}" is outside this repair scope.` };
  if (typeof edit.find !== 'string' || typeof edit.replace !== 'string') return { valid: false, reason: 'Edit must contain string find and replace values.' };
  if (!edit.find.length) return { valid: false, reason: 'The edit find value is empty.' };
  if (edit.find === edit.replace) return { valid: false, reason: 'Find and replace are identical; this is a no-op.' };
  if (placeholderPattern.test(edit.replace)) return { valid: false, reason: 'Replacement is a placeholder instruction, not authored content.' };
  const current = sourceValue(question, edit.field);
  if (typeof current !== 'string') return { valid: false, reason: `Source field "${edit.field}" is unavailable.` };
  if (!current.includes(edit.find)) return { valid: false, reason: 'The find value does not exist in the source field.' };
  if (facultyOnlyRepairs.has(result.repair)) return { valid: false, reason: 'This repair type must remain faculty-authored.' };
  return { valid: true, reason: 'Source, scope, and replacement checks passed.' };
}
function category(result) {
  if (result.route === 'faculty_review' || (result.verdict === 'defect' && result.repair && facultyOnlyRepairs.has(result.repair))) return 'needs_review';
  if (result.verdict === 'defect') return 'defect';
  if (result.verdict === 'no_error') return 'no_error';
  return 'no_action';
}
function status(result, editCheck) {
  if (category(result) === 'needs_review') return 'Faculty review required';
  if (category(result) === 'defect' && result.route !== 'no_change') return editCheck.valid ? 'Ready for faculty approval' : 'Faculty review required';
  if (result.verdict === 'no_error') return 'No error detected';
  return 'No action required';
}
function actionFor(result, editCheck) {
  if (result.verdict === 'no_error') return 'No action required';
  if (category(result) === 'needs_review' || !editCheck.valid && result.edit) return 'Escalate for further review';
  if (result.edit && editCheck.valid) return 'Approve proposal';
  return 'No action required';
}
function currentResult(id) { return state.results.find(x => x.reportId === id); }
function reportContext(id) {
  const result = currentResult(id);
  const report = state.reports.find(x => x.reportId === id);
  const question = state.questions.find(x => x._id === result.questionId);
  const edit = state.activeEdits.get(id) || result.edit;
  const editResult = edit === result.edit ? result : { ...result, edit };
  return { result, report, question, edit, editCheck: validateEdit(editResult, question) };
}
async function init() {
  try {
    const [reports, questions, results] = await Promise.all([
      fetch('../data/reports.json').then(response => { if (!response.ok) throw Error('reports'); return response.json(); }),
      fetch('../data/questions.json').then(response => { if (!response.ok) throw Error('questions'); return response.json(); }),
      fetch('../results.json').then(response => { if (!response.ok) throw Error('results'); return response.json(); })
    ]);
    Object.assign(state, { reports, questions, results, history: JSON.parse(sessionStorage.getItem('acadza-audit') || '[]') });
    renderStats(); renderQueue();
    document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
    $('#filter').addEventListener('change', renderQueue); $('#search').addEventListener('input', renderQueue);
    $('#close-drawer').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDrawer(); });
  } catch (error) {
    $('#stats').innerHTML = '<div class="overview-card error-state">Could not load the review data. Start the local server from the project root and try again.</div>';
    console.error(error);
  }
}
function counts() {
  return state.results.reduce((all, result) => { const key = category(result); all[key] = (all[key] || 0) + 1; return all; }, {});
}
function renderStats() {
  const verdictCounts = state.results.reduce((all, result) => { all[result.verdict] = (all[result.verdict] || 0) + 1; return all; }, {});
  const pending = state.results.filter(result => category(result) === 'needs_review' || (category(result) === 'defect' && result.route !== 'no_change')).length;
  const approved = state.history.filter(entry => entry.action === 'Approved proposal').length;
  const cards = [
    ['Total reports', state.reports.length, 'Every supplied report'],
    ['Suspected defects', verdictCounts.defect || 0, 'AI verdict = defect'],
    ['Student misunderstandings', verdictCounts.no_error || 0, 'AI verdict = no error'],
    ['Pending faculty reviews', pending, 'Review-required or actionable defects'],
    ['Approved repairs', approved, 'This session audit only']
  ];
  $('#stats').innerHTML = cards.map(card => `<div class="stat"><div class="label">${card[0]}</div><div class="value">${card[1]}</div><div class="trend">${card[2]}</div></div>`).join('');
  $('#nav-count').textContent = pending;
}
function renderQueue() {
  const filter = $('#filter').value, term = $('#search').value.toLowerCase();
  const byQuestion = Object.fromEntries(state.questions.map(question => [question._id, question]));
  const reportsByQuestion = state.reports.reduce((groups, report) => {
    groups[report.questionId] = (groups[report.questionId] || 0) + 1;
    return groups;
  }, {});
  const rows = state.results.map(result => ({ result, report: state.reports.find(report => report.reportId === result.reportId), question: byQuestion[result.questionId] }))
    .filter(item => (filter === 'all' || category(item.result) === filter) && (!term || JSON.stringify(item).toLowerCase().includes(term)))
    .sort((a, b) => (reportsByQuestion[b.result.questionId] - reportsByQuestion[a.result.questionId]) || (b.result.confidence - a.result.confidence));
  const descriptions = { all: 'All reports', needs_review: 'Needs faculty review', defect: 'Suspected defects', no_error: 'Student misunderstandings / no error', no_action: 'No action required' };
  $('#queue-description').textContent = `${descriptions[filter]} · every report appears exactly once`;
  $('#queue-total').textContent = rows.length;
  $('#case-list').innerHTML = rows.length ? rows.map(item => {
    const { result, report, question } = item, check = validateEdit(result, question);
    return `<article class="case" tabindex="0" role="button" aria-label="Open ${esc(result.reportId)}" data-id="${esc(result.reportId)}">
      <div class="case-id">${esc(result.reportId)}<small>${esc(result.questionId)}</small></div>
      <div class="case-main"><h3>${esc(question.subject)} · ${esc(question.chapter)}</h3><p>${esc(report.comment)}</p>
        <small class="related-count">${reportsByQuestion[result.questionId]} report${reportsByQuestion[result.questionId] === 1 ? '' : 's'} on this question</small>
        <span class="chip ${category(result)}">${esc(result.verdict)}</span>${result.repair ? `<span class="repair">${esc(result.repair)}</span>` : ''}</div>
      <div class="confidence"><strong>${Math.round(result.confidence * 100)}%</strong><small>confidence</small><div class="bar"><i style="width:${result.confidence * 100}%"></i></div></div>
      <div class="route"><strong>${esc(status(result, check))}</strong><small>${esc(actionFor(result, check))}</small></div><div class="chev">›</div>
    </article>`;
  }).join('') : '<div class="overview-card empty-state"><h3>No reports in this category</h3><p>Try “All reports” or clear the search.</p></div>';
  document.querySelectorAll('.case').forEach(card => {
    card.addEventListener('click', () => openDrawer(card.dataset.id));
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDrawer(card.dataset.id); } });
  });
}
function openDrawer(id) {
  const context = reportContext(id);
  if (!context.result || !context.question) return;
  const { result, report, question, edit, editCheck } = context;
  const body = bodyOf(question), source = edit ? sourceValue(question, edit.field) : '';
  const after = editCheck.valid ? source.replace(edit.find, edit.replace) : '';
  const limitation = result.confidence >= .9 ? 'High confidence still indicates model-supported likelihood, not correctness; faculty approval is required.' : 'Medium or lower confidence is a signal for checking, not a guarantee of correctness.';
  $('#drawer-content').innerHTML = `<p class="eyebrow">REPORT ${esc(result.reportId)} · ${esc(report.source)}</p><h2>${esc(question.subject)} · ${esc(question.chapter)}</h2><p class="sub">${esc(question._id)} · ${esc(question.questionType)} · ${new Date(report.reportedAt).toLocaleDateString()}</p>
    <div class="detail-section"><div class="detail-label">STUDENT REPORT</div><div class="comment">“${esc(report.comment)}”</div></div>
    <div class="detail-section"><div class="detail-label">ORIGINAL QUESTION</div><div class="question">${body.question || '<em>No question text supplied</em>'}</div></div>
    <div class="detail-section"><div class="detail-label">AI DECISION · <span class="chip ${category(result)}">${esc(result.verdict)}</span> <span class="chip faculty_review">${Math.round(result.confidence * 100)}% confidence</span></div><p class="evidence">${esc(result.evidence)}</p><p class="limitation">${esc(limitation)}</p></div>
    <div class="detail-section"><div class="detail-label">PROPOSED REPAIR · ${esc(result.repair || 'NONE')}</div>${edit ? `<div class="repair-check ${editCheck.valid ? 'valid' : 'invalid'}"><strong>${editCheck.valid ? 'Validated proposal' : 'Proposal blocked'}</strong><span>${esc(editCheck.reason)}</span></div><div class="diff"><div><small>BEFORE · ${esc(edit.field)}</small>${editCheck.valid ? renderField(source, edit.field) : '<em>Unavailable until proposal is valid</em>'}</div><div class="after"><small>AFTER</small>${editCheck.valid ? renderField(after, edit.field) : '<em>Not eligible for approval</em>'}</div></div>` : '<div class="empty-proposal">No proposed edit. This report must not be presented as ready for approval.</div>'}</div>
    <div class="detail-section"><div class="detail-label">SUGGESTED STUDENT REPLY</div><div class="comment">${esc(result.student_reply)}</div></div>
    <div class="action-row">${actionButtons(result, editCheck, id)}</div>`;
  $('#drawer').classList.remove('hidden');
  document.querySelectorAll('.action-row button').forEach(button => button.addEventListener('click', () => handleAction(button.dataset.action, id)));
}
function actionButtons(result, check, id) {
  const approval = check.valid && result.route !== 'no_change' && category(result) !== 'needs_review';
  const edit = result.edit ? '<button data-action="Edit proposal">Edit proposal</button>' : '';
  return `${approval ? '<button class="approve" data-action="Approved proposal">Approve proposal</button>' : ''}${edit}${result.verdict === 'no_error' ? '<button data-action="Marked as no error">Mark as no error</button>' : '<button class="reject" data-action="Rejected proposal">Reject proposal</button>'}<button data-action="Escalated for further review">Escalate for further review</button>`;
}
function handleAction(action, id) {
  const context = reportContext(id);
  if (action === 'Approved proposal' && !context.editCheck.valid) { openDrawer(id); return; }
  if (action === 'Edit proposal') {
    if (!context.edit) return;
    const row = document.querySelector('.action-row');
    row.insertAdjacentHTML('afterbegin', `<label class="inline-edit"><span>Replacement</span><input id="edit-replacement" value="${esc(context.edit.replace)}"><button data-action="Save edited proposal">Save edit</button></label>`);
    const input = $('#edit-replacement');
    input.focus(); input.select();
    row.querySelector('[data-action="Save edited proposal"]').addEventListener('click', () => handleAction('Save edited proposal', id));
    return;
  }
  if (action === 'Save edited proposal') {
    const replacement = $('#edit-replacement')?.value;
    if (replacement === undefined) return;
    const edited = { ...context.edit, replace: replacement };
    const check = validateEdit({ ...context.result, edit: edited }, context.question);
    if (!check.valid) {
      const row = document.querySelector('.action-row');
      row.insertAdjacentHTML('beforeend', `<span class="save-error">${esc(check.reason)}</span>`);
      return;
    }
    state.activeEdits.set(id, edited); openDrawer(id); return;
  }
  const entry = { reportId: id, questionId: context.result.questionId, action, facultyId: null, timestamp: new Date().toISOString(), originalContent: context.editCheck.valid ? sourceValue(context.question, context.edit.field) : null, approvedContent: action === 'Approved proposal' ? context.edit.replace : null };
  state.history.unshift(entry); sessionStorage.setItem('acadza-audit', JSON.stringify(state.history)); renderStats(); renderHistory(); openDrawer(id);
}
function closeDrawer() { $('#drawer').classList.add('hidden'); }
function switchView(view) {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  document.querySelectorAll('.view').forEach(item => item.classList.add('hidden')); $(`#${view}-view`).classList.remove('hidden');
  $('#current-view').textContent = view.replaceAll('_', ' ').toUpperCase(); $('#page-title').textContent = view === 'queue' ? 'Review queue' : view === 'overview' ? 'Quality overview' : 'Audit history';
  if (view === 'overview') renderOverview(); if (view === 'history') renderHistory();
}
function renderOverview() {
  const grouped = counts();
  $('#overview-view').innerHTML = `<div class="overview-card"><h2>Report health</h2><p class="evidence">Counts are mutually exclusive by queue category; each report is counted once. Defect and no-error totals use the AI verdict field.</p><div class="bars"><div style="height:${(grouped.defect || 0) * 5 + 15}%"><span>Defects<br>${grouped.defect || 0}</span></div><div style="height:${(grouped.no_error || 0) * 5 + 15}%"><span>No error<br>${grouped.no_error || 0}</span></div><div style="height:${(grouped.needs_review || 0) * 5 + 15}%"><span>Review<br>${grouped.needs_review || 0}</span></div><div style="height:${(grouped.no_action || 0) * 5 + 15}%"><span>No action<br>${grouped.no_action || 0}</span></div></div></div>`;
}
function renderHistory() {
  $('#history-view').innerHTML = `<div class="overview-card"><h2>Audit history</h2><p class="evidence">Faculty identity is recorded only when supplied; this fixture does not supply one.</p>${state.history.length ? state.history.map(entry => `<div class="audit"><strong>${esc(entry.reportId)}</strong> · ${esc(entry.action)} · ${entry.facultyId ? esc(entry.facultyId) : 'faculty identity unavailable'}<span>${new Date(entry.timestamp).toLocaleString()}</span></div>`).join('') : '<p class="empty-state">Actions taken in this session will appear here.</p>'}</div>`;
}
init();

const AI_USAGE_ENDPOINT = window.CONFIG?.AI_USAGE_ENDPOINT || 'https://ai.kitzer.net/api/ai-usage';

function formatNumber(value, digits = 0) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('he-IL', { maximumFractionDigits: digits }).format(n);
}

function formatReset(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('he-IL', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem'
    }).format(new Date(iso));
  } catch { return '—'; }
}

function statusLabel(status) {
  return ({ safe: 'SAFE', warn: 'WATCH', critical: 'HIGH', blocked: 'PAUSED' })[status] || '—';
}

function buildUsageWidget() {
  const host = document.querySelector('.btn-group-secondary') || document.querySelector('.control-panel');
  if (!host || document.getElementById('aiUsageToggle')) return null;

  const wrap = document.createElement('div');
  wrap.className = 'ai-usage-wrap';

  const button = document.createElement('button');
  button.id = 'aiUsageToggle';
  button.type = 'button';
  button.className = 'btn ghost ai-usage-toggle';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'aiUsagePanel');
  button.textContent = '🤖 AI —';

  const panel = document.createElement('section');
  panel.id = 'aiUsagePanel';
  panel.className = 'ai-usage-panel';
  panel.hidden = true;
  panel.setAttribute('dir', 'rtl');
  panel.innerHTML = `
    <div class="ai-usage-head">
      <div>
        <span class="ai-usage-kicker">CLOUDFLARE WORKERS AI</span>
        <strong>שימוש היום</strong>
      </div>
      <span class="ai-usage-status">—</span>
    </div>
    <div class="ai-usage-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <span></span>
    </div>
    <div class="ai-usage-main"><strong>—</strong><span> / 10,000 Neurons</span></div>
    <div class="ai-usage-grid">
      <div><span>נשאר</span><strong data-k="remaining">—</strong></div>
      <div><span>בקשות היום</span><strong data-k="requests">—</strong></div>
      <div><span>Tokens</span><strong data-k="tokens">—</strong></div>
      <div><span>אתמול</span><strong data-k="yesterday">—</strong></div>
      <div><span>ממוצע 7 ימים</span><strong data-k="average">—</strong></div>
      <div><span>עוד תקצירים משוער</span><strong data-k="summaries">—</strong></div>
    </div>
    <div class="ai-usage-foot">
      <span data-k="model">—</span>
      <span>איפוס: <b data-k="reset">—</b></span>
    </div>
    <p class="ai-usage-note">Live counter של KITZER. עצירה אוטומטית לפני המכסה החינמית כדי להשאיר מרווח ביטחון.</p>
  `;

  button.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  });

  wrap.append(button, panel);
  host.prepend(wrap);
  return { button, panel };
}

function renderUsage(widget, data) {
  const { button, panel } = widget;
  const pct = Math.max(0, Math.min(100, Number(data.percent_used || 0)));
  const status = data.status || 'safe';
  const hardLimit = Number(data.hard_limit_neurons || 10_000);
  const softLimit = Number(data.soft_limit_neurons || 8_500);

  button.textContent = `🤖 AI ${Math.round(pct)}%`;
  button.dataset.status = status;
  button.title = `${formatNumber(data.neurons_used, 1)} / ${formatNumber(hardLimit)} Neurons`;

  panel.dataset.status = status;
  const statusEl = panel.querySelector('.ai-usage-status');
  statusEl.textContent = statusLabel(status);

  const meter = panel.querySelector('.ai-usage-meter');
  meter.setAttribute('aria-valuenow', String(Math.round(pct)));
  meter.querySelector('span').style.width = `${pct}%`;

  panel.querySelector('.ai-usage-main strong').textContent = formatNumber(data.neurons_used, 1);
  panel.querySelector('.ai-usage-main span').textContent = ` / ${formatNumber(hardLimit)} Neurons`;
  panel.querySelector('[data-k="remaining"]').textContent = formatNumber(data.neurons_remaining, 1);
  panel.querySelector('[data-k="requests"]').textContent = formatNumber(data.requests_today);
  panel.querySelector('[data-k="tokens"]').textContent = formatNumber(data.total_tokens_today);
  panel.querySelector('[data-k="yesterday"]').textContent = formatNumber(data.yesterday_neurons, 1);
  panel.querySelector('[data-k="average"]').textContent = formatNumber(data.seven_day_avg_neurons, 1);
  panel.querySelector('[data-k="summaries"]').textContent = data.estimated_summaries_remaining == null ? '—' : `~${formatNumber(data.estimated_summaries_remaining)}`;
  panel.querySelector('[data-k="model"]').textContent = String(data.model || '').split('/').pop() || 'Workers AI';
  panel.querySelector('[data-k="reset"]').textContent = formatReset(data.reset_at);
  panel.querySelector('.ai-usage-note').textContent =
    `Live counter של KITZER. עצירה אוטומטית ב־${formatNumber(softLimit)} Neurons כדי להשאיר מרווח ביטחון מהמכסה החינמית.`;
}

function renderUsageError(widget) {
  widget.button.textContent = '🤖 AI ?';
  widget.button.title = 'נתוני שימוש AI אינם זמינים כרגע';
  const main = widget.panel.querySelector('.ai-usage-main');
  if (main) main.innerHTML = '<strong>לא זמין כרגע</strong>';
}

async function refreshAiUsage(widget) {
  try {
    const response = await fetch(AI_USAGE_ENDPOINT, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const data = await response.json();
    if (!data?.ok) throw new Error(data?.error || 'USAGE_FAILED');
    renderUsage(widget, data);
  } catch (error) {
    console.warn('KITZER AI usage unavailable', error);
    renderUsageError(widget);
  }
}

function initAiUsage() {
  const widget = buildUsageWidget();
  if (!widget) return;
  refreshAiUsage(widget);
  window.setInterval(() => refreshAiUsage(widget), 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshAiUsage(widget);
  });
  window.addEventListener('kitzer:ai-used', () => refreshAiUsage(widget));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAiUsage, { once: true });
} else {
  initAiUsage();
}

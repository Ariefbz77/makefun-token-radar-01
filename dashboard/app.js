/**
 * Token Launch Radar dashboard.
 * Reads window.TOKEN_RADAR (written by main.ts into data.js) and renders the
 * ranked board with filters, sorting and a per-protocol detail view.
 * No network access: every number comes from the bundled snapshot.
 */
(function () {
  'use strict';
  var DATA = window.TOKEN_RADAR || { rows: [], multiples: [], comparables: [], watchlist_count: 0, early_count: 0 };
  var rows = DATA.rows || [];
  var state = { q: '', cat: '', chain: '', minTvl: 0, watchOnly: false, earlyOnly: false, sortKey: 'rank', sortDir: 1 };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    if (n == null || !isFinite(n)) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(n) {
    if (n == null || !isFinite(n)) return '—';
    var v = (Math.round(n * 10) / 10).toFixed(1);
    return (n > 0 ? '+' : '') + v + '%';
  }
  function ageText(days) {
    if (days == null) return 'Unknown';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function bySlug(slug) {
    for (var i = 0; i < rows.length; i += 1) if (rows[i].slug === slug) return rows[i];
    return null;
  }
  function comparablesFor(category) {
    var list = DATA.comparables || [];
    for (var i = 0; i < list.length; i += 1) if (list[i].category === category) return list[i];
    return null;
  }

  function renderFacts() {
    var top = rows[0];
    var med = rows.length ? rows[Math.floor(rows.length / 2)].implied_value_usd : 0;
    $('facts').innerHTML =
      '<div class="fact"><b>' + rows.length + '</b><span>pre-token protocols</span></div>' +
      '<div class="fact"><b>' + (DATA.watchlist_count || 0) + '</b><span>on the watchlist</span></div>' +
      '<div class="fact"><b>' + (DATA.early_count || 0) + '</b><span>discovered beyond the watchlist</span></div>' +
      '<div class="fact"><b>' + money(med) + '</b><span>median implied value</span></div>' +
      '<div class="fact"><b>' + esc(top ? top.name : '—') + '</b><span>top: ' + money(top ? top.implied_value_usd : 0) + '</span></div>' +
      '<div class="fact"><b>' + esc(DATA.as_of || '—') + '</b><span>snapshot date</span></div>';
  }

  function renderMultiples() {
    var body = '';
    (DATA.multiples || []).forEach(function (m) {
      body += '<tr><td>' + esc(m.category) + '</td><td class="num">' + m.multiple.toFixed(3) + '×</td>' +
        '<td class="num">' + m.live_n + '</td><td class="num">' + (m.median_ratio == null ? '—' : m.median_ratio.toFixed(3) + '×') + '</td></tr>';
    });
    $('multiples').querySelector('tbody').innerHTML = body;
  }

  function renderPodium() {
    var medals = ['#1 — Highest implied value', '#2 — Runner-up', '#3 — Third'];
    var html = '';
    rows.slice(0, 3).forEach(function (r, i) {
      html += '<article class="podium-card" data-slug="' + esc(r.slug) + '" tabindex="0" role="button" aria-label="Open ' + esc(r.name) + '">' +
        '<div class="place">' + medals[i] + '</div><h3>' + esc(r.name) + '</h3>' +
        '<p class="cat">' + esc(r.category) + ' · ' + esc(r.chains.slice(0, 3).join(', ')) + '</p>' +
        '<div class="val">' + moneyFull(r.implied_value_usd) + '</div>' +
        '<div class="tvl">TVL ' + moneyFull(r.tvl_usd == null ? 0 : r.tvl_usd) + ' · ' + pct(r.growth_pct_7d) + ' in 7d</div></article>';
    });
    $('podiumRow').innerHTML = html;
  }

  function fillSelects() {
    var cats = {}, chains = {};
    rows.forEach(function (r) {
      cats[r.category] = true;
      r.chains.forEach(function (c) { chains[c] = true; });
    });
    var catSel = $('cat'), chainSel = $('chain');
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o);
    });
    Object.keys(chains).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; chainSel.appendChild(o);
    });
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.watchOnly && !r.in_watchlist) return false;
      if (state.earlyOnly && r.in_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.minTvl && (r.tvl_usd || 0) < state.minTvl) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function sorted(list) {
    var key = state.sortKey, dir = state.sortDir;
    var val = function (r) {
      if (key === 'rank') return r.rank;
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'category') return r.category.toLowerCase();
      if (key === 'tvl') return r.tvl_usd || 0;
      if (key === 'implied') return r.implied_value_usd;
      if (key === 'growth') return r.growth_pct_7d == null ? -999 : r.growth_pct_7d;
      if (key === 'age') return r.age_days == null ? -1 : r.age_days;
      return r.rank;
    };
    return list.slice().sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.rank - b.rank;
    });
  }

  function renderBoard() {
    var list = sorted(filtered());
    var tbody = $('board').querySelector('tbody');
    var html = '';
    list.forEach(function (r) {
      var growthCls = r.growth_pct_7d == null ? '' : (r.growth_pct_7d >= 0 ? 'up' : 'down');
      html += '<tr data-slug="' + esc(r.slug) + '" tabindex="0">' +
        '<td class="rank num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' +
        '<span class="tag ' + (r.in_watchlist ? 'watch' : 'discovery') + '">' + (r.in_watchlist ? 'Watchlist' : 'Discovery') + '</span>' +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category) + '</td>' +
        '<td class="num">' + moneyFull(r.tvl_usd) + '</td>' +
        '<td class="num"><b>' + moneyFull(r.implied_value_usd) + '</b></td>' +
        '<td class="num ' + growthCls + '">' + pct(r.growth_pct_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td></tr>';
    });
    tbody.innerHTML = html;
    $('empty').hidden = list.length > 0;
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols';
    var ths = $('board').querySelectorAll('thead th');
    ths.forEach(function (th) {
      var k = th.getAttribute('data-sort');
      if (!k) return;
      th.textContent = th.textContent.replace(/ [▲▼]$/, '');
      if (k === state.sortKey) th.textContent += state.sortDir === 1 ? ' ▲' : ' ▼';
    });
  }

  function renderDetail(r) {
    var comp = comparablesFor(r.category);
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var compRows = '';
    if (comp && comp.live_rows) {
      compRows = comp.live_rows.slice(0, 8).map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td><td class="num">' + moneyFull(c.tvl_usd) + '</td>' +
          '<td class="num">' + moneyFull(c.mcap_usd) + '</td><td class="num">' + c.ratio.toFixed(3) + '×</td></tr>';
      }).join('');
    }
    var formula = 'TVL ' + moneyFull(r.tvl_usd) + ' × ' + r.category_multiple.toFixed(3) + ' (category) × ' +
      r.growth_multiplier.toFixed(3) + ' (growth) × ' + r.maturity_multiplier.toFixed(3) + ' (maturity) × ' +
      r.breadth_multiplier.toFixed(3) + ' (breadth) = <b>' + moneyFull(r.implied_value_usd) + '</b>';
    $('detailBody').innerHTML =
      '<h3>' + esc(r.name) + '</h3>' +
      '<p class="meta">Rank #' + r.rank + ' · ' + esc(r.category) + ' · ' + esc(r.chains.join(', ')) + ' · ' +
      (r.in_watchlist ? 'Watchlist — one of the snapshot\u2019s 40 flagged protocols' : 'Discovery — pre-token, outside the watchlist') + '</p>' +
      '<h4>Implied value</h4><p>' + formula + '</p>' +
      '<dl><dt>7d TVL change</dt><dd>' + pct(r.growth_pct_7d) + '</dd>' +
      '<dt>Age</dt><dd>' + ageText(r.age_days) + '</dd>' +
      '<dt>Category multiple</dt><dd>' + r.category_multiple.toFixed(3) + '× from ' + r.category_live_n + ' live protocols</dd></dl>' +
      '<h4>Farm plan — 7 steps</h4><ol>' + steps + '</ol>' +
      (compRows ? '<h4>Live comparables in ' + esc(r.category) + '</h4>' +
        '<table><thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>mcap/TVL</th></tr></thead><tbody>' + compRows + '</tbody></table>' : '');
    var dlg = $('detail');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    if (window.location.hash !== '#' + r.slug) {
      try { history.replaceState(null, '', '#' + r.slug); } catch (e) { /* hash only */ }
    }
  }

  function openBySlug(slug) {
    var r = bySlug(slug);
    if (r) renderDetail(r);
  }

  function bind() {
    $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
    $('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
    $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
    $('minTvl').addEventListener('change', function (e) { state.minTvl = Number(e.target.value); renderBoard(); });
    $('watchOnly').addEventListener('change', function (e) { state.watchOnly = e.target.checked; if (e.target.checked) state.earlyOnly = false, $('earlyOnly').checked = false; renderBoard(); });
    $('earlyOnly').addEventListener('change', function (e) { state.earlyOnly = e.target.checked; if (e.target.checked) state.watchOnly = false, $('watchOnly').checked = false; renderBoard(); });
    $('board').querySelectorAll('thead th').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (!k) return;
        if (state.sortKey === k) state.sortDir *= -1;
        else { state.sortKey = k; state.sortDir = k === 'name' || k === 'category' ? 1 : -1; }
        renderBoard();
      });
    });
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-slug]');
      if (t) openBySlug(t.getAttribute('data-slug'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.getAttribute && e.target.getAttribute('data-slug')) {
        openBySlug(e.target.getAttribute('data-slug'));
      }
    });
    var dlg = $('detail');
    dlg.addEventListener('close', function () {
      try { history.replaceState(null, '', window.location.pathname); } catch (e) { /* hash only */ }
    });
  }

  function init() {
    renderFacts();
    renderMultiples();
    renderPodium();
    fillSelects();
    bind();
    renderBoard();
    var hash = window.location.hash ? window.location.hash.slice(1) : '';
    if (hash) openBySlug(decodeURIComponent(hash));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

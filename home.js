window.addEventListener('error', (e) => {
  const box = document.getElementById('errBox');
  if (box) {
    box.style.display = 'block';
    box.textContent = 'Something went wrong:\n' + (e.message || String(e));
  }
});

(function () {
  const search = document.getElementById('search');
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');
  const title = document.getElementById('resultsTitle');
  const chipsWrap = document.getElementById('filterChips');

  let sims = [];
  let activeCategory = 'all';

  function escapeHtml(t) {
    const d = document.createElement('div');
    d.textContent = t == null ? '' : String(t);
    return d.innerHTML;
  }

  function card(s) {
    const a = document.createElement('a');
    a.className = 'card';
    a.href = 'simulators/' + s.slug + '/';
    a.setAttribute('aria-label', 'Open ' + s.name + ' simulator');
    a.style.setProperty('--accent', s.accent || '#38bdf8');
    a.addEventListener('click', function () {
      if (window.EduLift) {
        window.EduLift.track('simulator_opened', { simulator: s.slug, name: s.name });
      }
    });
    const kw = (s.keywords || []).slice(0, 4)
      .map((k) => '<span class="kw">' + escapeHtml(k) + '</span>')
      .join('');
    a.innerHTML =
      '<div class="card-ico">' + escapeHtml(s.icon || '🧪') + '</div>' +
      '<div class="card-body">' +
        '<div class="card-title">' +
          '<h3>' + escapeHtml(s.name) + '</h3>' +
          '<span class="cat">' + escapeHtml(s.category || 'Simulator') + '</span>' +
        '</div>' +
        '<p class="tagline">' + escapeHtml(s.tagline || '') + '</p>' +
        '<p class="desc">' + escapeHtml(s.description || '') + '</p>' +
        '<div class="kw-row">' + kw + '</div>' +
        '<span class="open">Open simulator →</span>' +
      '</div>';
    return a;
  }

  function matches(s) {
    const q = search.value.trim().toLowerCase();
    if (!q) return true;
    const hay = [
      s.name, s.tagline, s.category, s.description, (s.keywords || []).join(' '),
    ].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function render() {
    const q = search.value.trim();
    const list = sims.filter((s) =>
      (activeCategory === 'all' || s.category === activeCategory) && matches(s)
    );
    grid.innerHTML = '';
    empty.hidden = list.length > 0;
    count.textContent = list.length
      ? list.length + ' simulator' + (list.length > 1 ? 's' : '')
      : '';
    title.textContent = q
      ? 'Results for "' + q + '"'
      : (activeCategory === 'all' ? 'All simulators' : activeCategory);
    for (const s of list) grid.appendChild(card(s));
  }

  function buildChips() {
    const cats = ['all'];
    for (const s of sims) {
      if (s.category && cats.indexOf(s.category) === -1) cats.push(s.category);
    }
    for (const c of cats) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (c === 'all' ? ' active' : '');
      b.textContent = c === 'all' ? 'All' : c;
      b.dataset.cat = c;
      b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false');
      b.addEventListener('click', () => {
        activeCategory = c;
        for (const x of chipsWrap.querySelectorAll('.chip')) {
          x.classList.toggle('active', x === b);
          x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
        }
        render();
      });
      chipsWrap.appendChild(b);
    }
  }

  fetch('simulators.json')
    .then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then((data) => {
      sims = (data && data.simulators) || [];
      buildChips();
      render();
    })
    .catch((err) => {
      console.error(err);
      grid.innerHTML = '<p class="empty">Could not load the simulator list. ' +
        'Make sure the site is served over HTTP (node dev-server.js).</p>';
    });

  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = grid.querySelector('a.card');
      if (first) window.location.href = first.getAttribute('href');
    }
  });
})();

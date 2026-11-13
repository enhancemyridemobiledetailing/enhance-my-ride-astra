(() => {
  const bar = document.getElementById('bar');
  const nav = document.getElementById('main-nav');
  const menu = document.getElementById('menu-toggle');
  const hero = document.querySelector('.hero');
  const phoneMode = window.matchMedia('(max-width: 700px)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let heroVisible = true;

  const updateBar = () => bar?.classList.toggle('on', window.scrollY > 40);
  window.addEventListener('scroll', updateBar, { passive: true });
  updateBar();

  menu?.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    nav?.classList.toggle('open', open);
  });
  nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    menu?.setAttribute('aria-expanded', 'false');
    menu?.setAttribute('aria-label', 'Open navigation');
    nav.classList.remove('open');
  }));

  const allHeroFilms = [...document.querySelectorAll('.hero-film')];
  const syncHeroFilms = () => {
    const mobile = phoneMode.matches;
    const activeFilms = allHeroFilms.filter(video => video.closest('.portrait-film') ? mobile : !mobile);
    allHeroFilms.forEach(video => {
      if (!activeFilms.includes(video)) video.pause();
    });
    if (reducedMotion.matches || navigator.connection?.saveData || !heroVisible || document.hidden) return;
    activeFilms.forEach(video => {
      if (!video.getAttribute('src')) {
        video.src = video.dataset.src;
        video.load();
      }
      const play = video.play();
      if (play && typeof play.catch === 'function') play.catch(() => {});
    });
  };
  if ('IntersectionObserver' in window && hero) {
    new IntersectionObserver(entries => {
      heroVisible = entries.some(entry => entry.isIntersecting);
      if (!heroVisible) allHeroFilms.forEach(video => video.pause());
      else syncHeroFilms();
    }, { threshold: 0.05 }).observe(hero);
  }
  phoneMode.addEventListener?.('change', syncHeroFilms);
  reducedMotion.addEventListener?.('change', syncHeroFilms);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) allHeroFilms.forEach(video => video.pause());
    else syncHeroFilms();
  });
  syncHeroFilms();

  const rigDetail = document.getElementById('rig-detail');
  const rigDots = [...document.querySelectorAll('.rig-dot')];
  rigDots.forEach(dot => dot.addEventListener('click', () => {
    rigDots.forEach(item => item.setAttribute('aria-pressed', String(item === dot)));
    if (rigDetail) rigDetail.textContent = dot.dataset.detail;
  }));

  const lightbox = document.getElementById('lightbox');
  const lightboxImage = lightbox?.querySelector('img');
  const lightboxCaption = lightbox?.querySelector('p');
  document.querySelectorAll('.work-card').forEach(card => card.addEventListener('click', () => {
    if (!lightbox || !lightboxImage) return;
    lightboxImage.src = card.dataset.image;
    lightboxImage.alt = card.dataset.alt || '';
    if (lightboxCaption) lightboxCaption.textContent = card.dataset.caption || '';
    lightbox.showModal();
  }));
  lightbox?.querySelector('.lightbox-close')?.addEventListener('click', () => lightbox.close());
  lightbox?.addEventListener('click', event => {
    if (event.target === lightbox) lightbox.close();
  });
  lightbox?.addEventListener('close', () => {
    if (lightboxImage) lightboxImage.src = '';
  });

  const askButton = document.getElementById('ask-button');
  const askPanel = document.getElementById('ask-panel');
  const askClose = document.getElementById('ask-close');
  const setAsk = open => {
    if (!askButton || !askPanel) return;
    askPanel.hidden = !open;
    askButton.setAttribute('aria-expanded', String(open));
  };
  askButton?.addEventListener('click', () => setAsk(askPanel?.hidden));
  askClose?.addEventListener('click', () => setAsk(false));
  askPanel?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setAsk(false)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setAsk(false);
  });

  const form = document.getElementById('quote-form');
  const formNote = document.getElementById('form-note');
  form?.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    const photoInput = form.querySelector('input[type="file"]');
    const photoNames = photoInput && photoInput.files.length ? Array.from(photoInput.files).map(file => file.name).join(', ') : 'No photos selected';
    const body = [
      'Quote request for Enhance My Ride',
      '',
      'Name: ' + data.get('name'),
      'Email: ' + data.get('email'),
      'Phone: ' + (data.get('phone') || 'Not provided'),
      'Service location: ' + data.get('location'),
      'Vehicle: ' + data.get('vehicle'),
      'Package: ' + data.get('package'),
      'Condition / request: ' + (data.get('condition') || 'Not provided'),
      'Selected photo filenames: ' + photoNames,
      '',
      'If photos are needed, attach them to this email before sending.'
    ].join('\n');
    const subject = 'Detailing quote request · ' + (data.get('vehicle') || 'Vehicle');
    if (formNote) formNote.textContent = 'Your email app should open with the request addressed to info@enhancemyride.com. Please attach any selected photos before sending.';
    window.location.href = 'mailto:info@enhancemyride.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  });

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();

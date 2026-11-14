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
  const gallery = document.getElementById('gallery-rail');
  const galleryToggle = document.getElementById('gallery-toggle');
  document.querySelectorAll('.work-card').forEach(card => card.addEventListener('click', () => {
    if (!lightbox || !lightboxImage) return;
    lightboxImage.src = card.dataset.image;
    lightboxImage.alt = card.dataset.alt || '';
    if (lightboxCaption) lightboxCaption.textContent = card.dataset.caption || '';
    lightbox.showModal();
  }));
  galleryToggle?.addEventListener('click', () => {
    const expanded = galleryToggle.getAttribute('aria-expanded') !== 'true';
    gallery?.classList.toggle('is-expanded', expanded);
    galleryToggle.setAttribute('aria-expanded', String(expanded));
    galleryToggle.textContent = expanded ? 'Show selected work' : 'View all work (49 photos)';
  });
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
  const formStatus = document.getElementById('form-status');
  const packageSelect = form?.querySelector('select[name="package"]');
  const requestIdField = form?.querySelector('input[name="request_id"]');
  const turnstileWrap = document.getElementById('turnstile-wrap');
  const turnstileResponse = document.getElementById('turnstile-response');
  const preferredDate = form?.querySelector('input[name="preferred_date"]');
  let turnstileWidgetId = null;
  if (requestIdField) requestIdField.value = makeRequestId();
  if (preferredDate) preferredDate.min = new Date().toISOString().slice(0, 10);

  const showFormStatus = (message, kind = 'error') => {
    if (!formStatus) return;
    formStatus.textContent = message;
    formStatus.hidden = false;
    formStatus.classList.toggle('is-error', kind === 'error');
    formStatus.classList.toggle('is-success', kind === 'success');
  };

  function makeRequestId() {
    return window.crypto?.randomUUID ? window.crypto.randomUUID() : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function addTurnstile(sitekey) {
    if (!sitekey || !turnstileWrap || document.getElementById('turnstile-api')) return;
    turnstileWrap.hidden = false;
    const script = document.createElement('script');
    script.id = 'turnstile-api';
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (!window.turnstile) return;
      turnstileWidgetId = window.turnstile.render('#turnstile-widget', {
        sitekey,
        theme: 'dark',
        action: 'booking_request',
        callback: token => { if (turnstileResponse) turnstileResponse.value = token; },
        'expired-callback': () => { if (turnstileResponse) turnstileResponse.value = ''; }
      });
    };
    script.onerror = () => showFormStatus('The security check did not load. Please refresh the page or call (323) 327-1806.');
    document.head.append(script);
  }

  const bookingConfigPromise = fetch('/api/config', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then(response => response.ok ? response.json() : Promise.reject(new Error('config unavailable')))
    .then(config => {
      if (config.mode === 'local_mock') {
        if (formNote) formNote.textContent = 'Local test mode: requests and photos are saved only in local mock storage. No email is sent.';
      } else if (config.mode === 'live' && config.turnstileSiteKey) {
        if (formNote) formNote.textContent = 'Your request and photos are sent securely to Enhance My Ride.';
        addTurnstile(config.turnstileSiteKey);
      } else if (formNote) {
        formNote.textContent = 'The secure booking backend is not fully configured. No request will be sent until setup is complete.';
      }
      return config;
    })
    .catch(() => {
      if (formNote) formNote.textContent = 'The booking service is unavailable. No request has been sent.';
      return { mode: 'unavailable' };
    });

  document.querySelectorAll('a[data-package]').forEach(link => link.addEventListener('click', () => {
    if (packageSelect) packageSelect.value = link.dataset.package;
  }));
  const queryPackage = new URLSearchParams(window.location.search).get('package');
  if (queryPackage && packageSelect && [...packageSelect.options].some(option => option.value === queryPackage)) {
    packageSelect.value = queryPackage;
  }
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    formStatus && (formStatus.hidden = true);
    const trap = form.querySelector('input[name="website"]');
    if (trap?.value) return;

    const photoInput = form.querySelector('input[type="file"]');
    const photos = [...(photoInput?.files || [])];
    const totalBytes = photos.reduce((sum, file) => sum + file.size, 0);
    if (photos.length > 5) {
      showFormStatus('Please select no more than 5 vehicle photos.');
      photoInput?.focus();
      return;
    }
    if (totalBytes > 8 * 1024 * 1024) {
      showFormStatus('Please keep the selected vehicle photos under 8 MB total.');
      photoInput?.focus();
      return;
    }
    if (photos.some(file => !file.type.startsWith('image/'))) {
      showFormStatus('Please select image files for the vehicle photos.');
      photoInput?.focus();
      return;
    }

    const config = await bookingConfigPromise;
    if (config.mode !== 'local_mock' && config.mode !== 'live') {
      showFormStatus('The secure booking backend is not ready. Nothing was sent or uploaded. Please call (323) 327-1806.');
      return;
    }
    if (config.mode === 'live' && !turnstileResponse?.value) {
      showFormStatus('Please complete the security check before submitting.');
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    const originalLabel = submitButton?.textContent;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'SENDING REQUEST…';
    }
    const formData = new FormData(form);
    if (config.mode === 'local_mock') formData.set('turnstile_token', 'local-mock-pass');
    try {
      const response = await fetch('/api/bookings', { method: 'POST', body: formData, headers: { Accept: 'application/json' } });
      const result = await response.json().catch(() => null);
      if (result?.received === true) {
        showFormStatus('Your request and photos were securely saved, but the email notification is still pending. Please call (323) 327-1806 to confirm.', 'error');
        return;
      }
      if (!response.ok || result?.ok !== true) throw new Error('The request service did not confirm receipt.');
      form.reset();
      if (requestIdField) requestIdField.value = makeRequestId();
      if (config.mode === 'local_mock') {
        showFormStatus('Local test request saved with its photos. No email was sent.', 'success');
      } else {
        showFormStatus('Your detail request was received. We’ll follow up using the contact information you provided.', 'success');
      }
      if (turnstileWidgetId !== null) window.turnstile?.reset(turnstileWidgetId);
    } catch {
      showFormStatus('We could not confirm delivery. Your request has not been marked as sent; please try again or call (323) 327-1806.');
      if (turnstileWidgetId !== null) window.turnstile?.reset(turnstileWidgetId);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel || 'SUBMIT DETAIL REQUEST';
      }
    }
  });

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();

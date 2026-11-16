(() => {
  // Edit this one object only when an approved promotion is active.
  const PROMOTION = Object.freeze({ active: false, message: '', href: '/index.html#request-form', linkText: 'Learn more' });
  const promoBar = document.getElementById('promo-announcement');
  if (PROMOTION.active && PROMOTION.message && promoBar) {
    const promoMessage = document.getElementById('promo-message');
    const promoLink = document.getElementById('promo-link');
    if (promoMessage && promoLink) {
      promoMessage.textContent = PROMOTION.message;
      promoLink.href = PROMOTION.href;
      promoLink.textContent = PROMOTION.linkText;
      promoBar.hidden = false;
      document.body.classList.add('has-promo');
    }
  }

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
  nav?.querySelectorAll('.nav-dropdown-menu a').forEach(link => link.addEventListener('click', () => {
    const dropdown = link.closest('details');
    if (dropdown) dropdown.open = false;
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

  const reviewGrid = document.getElementById('review-grid');
  const reviewSummary = document.getElementById('review-summary');
  const reviewStatus = document.getElementById('google-reviews-status');
  const googlePhotosBlock = document.getElementById('google-photos-block');
  const googlePhotoGrid = document.getElementById('google-photo-grid');
  const safeHttps = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  };
  const addText = (parent, tag, text, className = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    parent.append(node);
    return node;
  };
  function renderGoogleReviews(data) {
    if (reviewSummary && (data.rating !== null || data.reviewCount !== null)) {
      const rating = data.rating === null ? '' : `${Number(data.rating).toFixed(1)} / 5`;
      const count = Number.isInteger(data.reviewCount) ? `${data.reviewCount.toLocaleString()} Google reviews` : 'Google reviews';
      reviewSummary.replaceChildren();
      addText(reviewSummary, 'span', [rating, count].filter(Boolean).join(' · '));
      const link = document.createElement('a');
      link.href = safeHttps(data.reviewsUri) || 'https://search.google.com/local/reviews?placeid=ChIJycCMkhJhCkoRHL89gmaro1g';
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Google Maps';
      link.setAttribute('translate', 'no');
      reviewSummary.append(link);
      reviewSummary.hidden = false;
      const heroSummary = document.getElementById('google-summary');
      if (heroSummary) {
        heroSummary.textContent = `${rating} · ${count}`;
        heroSummary.hidden = false;
      }
    }
    if (Array.isArray(data.reviews) && data.reviews.length && reviewGrid) {
      reviewGrid.replaceChildren();
      for (const review of data.reviews) {
        const card = document.createElement('blockquote');
        card.className = 'review-live-card';
        const authorLine = document.createElement('div');
        authorLine.className = 'review-author';
        if (review.authorPhotoUri && safeHttps(review.authorPhotoUri)) {
          const avatar = document.createElement('img');
          avatar.src = safeHttps(review.authorPhotoUri);
          avatar.alt = `${review.author || 'Google reviewer'} profile photo`;
          avatar.loading = 'lazy';
          avatar.referrerPolicy = 'no-referrer';
          avatar.onerror = () => {
            const fallback = document.createElement('span');
            fallback.className = 'review-avatar-fallback';
            fallback.textContent = (review.author || 'G').trim().slice(0, 1).toUpperCase();
            avatar.replaceWith(fallback);
          };
          authorLine.append(avatar);
        } else {
          const fallback = document.createElement('span');
          fallback.className = 'review-avatar-fallback';
          fallback.textContent = (review.author || 'G').trim().slice(0, 1).toUpperCase();
          authorLine.append(fallback);
        }
        const authorWrap = document.createElement('span');
        const authorUrl = safeHttps(review.authorUri);
        if (authorUrl) {
          const authorLink = document.createElement('a');
          authorLink.href = authorUrl;
          authorLink.target = '_blank';
          authorLink.rel = 'noopener';
          authorLink.textContent = review.author || 'Google Maps reviewer';
          authorWrap.append(authorLink);
        } else addText(authorWrap, 'span', review.author || 'Google Maps reviewer');
        addText(authorWrap, 'small', review.date || 'Google Maps review');
        authorLine.append(authorWrap);
        const stars = document.createElement('span');
        stars.className = 'review-stars';
        const starsValue = Number.isFinite(Number(review.rating)) ? Math.round(Number(review.rating)) : 0;
        stars.textContent = starsValue ? '★'.repeat(starsValue) : '';
        stars.setAttribute('aria-label', starsValue ? `${starsValue} out of 5 stars` : 'Google review');
        authorLine.append(stars);
        card.append(authorLine);
        addText(card, 'p', review.text || '');
        const source = document.createElement('a');
        source.className = 'review-source';
        source.href = safeHttps(review.sourceUri) || 'https://search.google.com/local/reviews?placeid=ChIJycCMkhJhCkoRHL89gmaro1g';
        source.target = '_blank';
        source.rel = 'noopener';
        source.textContent = 'View review on Google Maps';
        source.setAttribute('translate', 'no');
        card.append(source);
        reviewGrid.append(card);
      }
    }
    if (googlePhotosBlock && googlePhotoGrid && Array.isArray(data.photos) && data.photos.length) {
      googlePhotoGrid.replaceChildren();
      for (const photo of data.photos) {
        if (!photo.name) continue;
        const figure = document.createElement('figure');
        figure.className = 'google-photo';
        const sourceLink = document.createElement('a');
        sourceLink.href = safeHttps(photo.sourceUri) || 'https://search.google.com/local/reviews?placeid=ChIJycCMkhJhCkoRHL89gmaro1g';
        sourceLink.target = '_blank';
        sourceLink.rel = 'noopener';
        const image = document.createElement('img');
        image.src = `/api/google-review-photo?name=${encodeURIComponent(photo.name)}&size=320`;
        image.alt = 'Photo from the Enhance My Ride Google Maps business listing';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.referrerPolicy = 'no-referrer';
        image.onerror = () => figure.remove();
        sourceLink.append(image);
        figure.append(sourceLink);
        const caption = document.createElement('figcaption');
        const authors = Array.isArray(photo.authors) ? photo.authors.filter(author => author.name) : [];
        if (authors.length) {
          authors.forEach((author, index) => {
            if (index) caption.append(document.createTextNode(', '));
            const credit = document.createElement('a');
            const authorProfile = safeHttps(author.uri);
            if (authorProfile) {
              credit.href = authorProfile;
              credit.target = '_blank';
              credit.rel = 'noopener';
            }
            credit.textContent = author.name;
            caption.append(credit);
          });
        } else caption.append(document.createTextNode('Photo contributor'));
        const mapsLabel = document.createElement('a');
        mapsLabel.href = sourceLink.href;
        mapsLabel.target = '_blank';
        mapsLabel.rel = 'noopener';
        mapsLabel.textContent = 'Google Maps';
        mapsLabel.setAttribute('translate', 'no');
        caption.append(document.createTextNode(' · '), mapsLabel);
        figure.append(caption);
        googlePhotoGrid.append(figure);
      }
      googlePhotosBlock.hidden = false;
    }
    if (reviewStatus) reviewStatus.textContent = 'Google provides up to five reviews, ordered by relevance. Reviewer profile photos are shown when provided; business-listing photos are displayed separately with contributor credit.';
  }
  if (reviewGrid) {
    fetch('/api/reviews', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(async response => ({ response, data: await response.json().catch(() => null) }))
      .then(({ response, data }) => {
        if (response.ok && data?.ok === true && data.mode === 'live') renderGoogleReviews(data);
      })
      .catch(() => {});
  }

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


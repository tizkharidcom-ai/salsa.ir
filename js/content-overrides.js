/* Applies admin-edited content before deferred animation scripts run. The
   normal path is parser-preloaded /api/content-bootstrap.js; sync XHR remains
   only as a compatibility fallback for older static deployments. */
(function () {
  var data = window.__WESTO_CONTENT__;
  if (!data) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/content', false);
      xhr.send();
      if (xhr.status !== 200) return;
      data = JSON.parse(xhr.responseText);
    } catch (e) {
      return;
    }
  }
  var content = data.content || {};
  var products = data.products || [];
  var faq = data.faq || [];

  // Original strings baked into the HTML, keyed like the DB. When the admin
  // changes a value, every text node still holding the default is swapped.
  var DEFAULTS = {
    'nav.login': 'ورود',
    'nav.menu': 'منو',
    'nav.contact': 'تماس',
    'nav.sound_on': 'روشن',
    'nav.link.gamme': 'محصولات',
    'nav.link.benefits': 'مزایا',
    'nav.link.faq': 'سؤالات متداول',
    'nav.link.newsletter': 'خبرنامه',
    'nav.copyright': '© ۲۰۲۶ Westo',
    'hero.scroll_hint': 'برای دیدن غذاها اسکرول کنید',
    'ingredients.sugar.badge': '۱۱ گرم شکر',
    'ingredients.sugar.title1': 'شکر',
    'ingredients.sugar.title2': 'کمتر',
    'ingredients.sugar.desc': 'یک نوشیدنی انرژی‌زا با شکر کمتر، فقط با شکر نیشکر؛ انتخاب‌شده به‌خاطر منشأ گیاهی و طعم خوشایندش.',
    'ingredients.aroma.badge': 'طعم‌دهنده‌های مصنوعی',
    'ingredients.aroma.title1': 'طعم‌دهنده‌های',
    'ingredients.aroma.title2': 'طبیعی',
    'ingredients.aroma.desc': 'برای قدرت عطر و غنای طعم، طعم‌دهنده‌های طبیعی برگرفته از میوه‌ها و گیاهان را با وسواس انتخاب کرده‌ایم.',
    'ingredients.caffeine.badge': 'کافئین مصنوعی',
    'ingredients.caffeine.title': 'کافئین از دانه‌های قهوه',
    'ingredients.caffeine.desc': 'برای انرژی، دانه‌های قهوه را انتخاب کرده‌ایم؛ منبع طبیعی کافئین، در کنار گوارانا که آن هم طبیعی است.',
    'ingredients.stevia.badge': 'آسپارتام، سوکرالوز، آسه‌سولفام K',
    'ingredients.stevia.title': 'استویا',
    'ingredients.stevia.desc': 'برای تکمیل شکر نیشکر و افزودن شیرینی و لذت، یک شیرین‌کننده گیاهی با عصاره استویا اضافه کرده‌ایم.',
    'faq.title1': 'سؤالات',
    'faq.title2': 'متداول',
    'newsletter.title': 'به ما بپیوندید',
    'newsletter.desc': 'به جمع ما بپیوندید تا از اخبار و محصولات تازه Westo زودتر از همه باخبر شوید.',
    'newsletter.email_label': 'آدرس ایمیل شما',
    'newsletter.submit': 'ثبت‌نام',
    'newsletter.consent': 'با ثبت‌نام، شما می‌پذیرید:',
    'newsletter.privacy_link': 'سیاست حریم خصوصی',
    'newsletter.success': 'ثبت‌نام شما تأیید شد.',
    'newsletter.error': 'ثبت‌نام شما تأیید نشد.',
    'footer.copyright': '© ۲۰۲۶ Westo',
    'footer.legal': 'اطلاعات حقوقی',
    'footer.cgu': 'شرایط استفاده',
    'footer.privacy': 'سیاست حریم خصوصی',
    'footer.tiktok': 'تیک‌تاک',
    'footer.instagram': 'اینستاگرام',
    'entrance.tagline': 'کافه‌رستوران برای آرامش تو',
    'entrance.subtitle': 'Cafe & Restaurant',
    'entrance.storyLead': 'در حال آماده‌سازی تجربه شما…',
    'entrance.quote': 'هر فنجان قصه‌ای دارد.',
    'entrance.cta': 'ورود به منو',
    'entrance.step.digitalMenu': 'منو دیجیتال',
    'entrance.step.onlineOrder': 'سفارش آنلاین',
    'entrance.step.reserveTable': 'رزرو میز',
    'entrance.step.quickEntry': 'ورود سریع',
  };

  // --- 1) generic text swaps -------------------------------------------
  // Build one replacement table and walk text nodes once. The baseline used
  // a TreeWalker for admin overrides and then a second whole-body element
  // scan for the legacy scroll hint. Keeping both jobs in one text walk avoids
  // a second startup-wide DOM traversal without changing the resulting copy.
  var byDefault = {
    'برای کشف، اسکرول کنید': 'برای دیدن غذاها اسکرول کنید',
  };
  Object.keys(DEFAULTS).forEach(function (key) {
    var def = DEFAULTS[key];
    var val = content[key];
    if (typeof val === 'string' && val !== '' && val !== def) byDefault[def] = val;
  });
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  var node;
  while ((node = walker.nextNode())) {
    var trimmed = node.nodeValue.trim();
    if (trimmed && Object.prototype.hasOwnProperty.call(byDefault, trimmed)) {
      node.nodeValue = node.nodeValue.replace(trimmed, byDefault[trimmed]);
    }
  }

  // --- 2) title / meta ---------------------------------------------------
  var siteTitle = (data.settings && data.settings.siteTitle) || '';
  var siteDescription = (data.settings && data.settings.metaDescription) || '';
  if (!siteTitle || /ciao\s*energy/i.test(siteTitle)) siteTitle = 'Westo — منوی کافه و رستوران';
  if (!siteDescription || /ciao\s*energy/i.test(siteDescription)) {
    siteDescription = 'منوی آنلاین وستو؛ دسته‌ها، جزئیات غذاها و ثبت سفارش روی تیبل.';
  }
  document.title = siteTitle;
  var meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', siteDescription);
  document.querySelectorAll('meta[property="og:title"], meta[name="twitter:title"]').forEach(function (el) {
    el.setAttribute('content', siteTitle);
  });
  document
    .querySelectorAll('meta[property="og:description"], meta[name="twitter:description"]')
    .forEach(function (el) {
      el.setAttribute('content', siteDescription);
    });
  document.querySelectorAll('h1').forEach(function (heading) {
    if (/ciao\s*energy/i.test(heading.textContent || '')) heading.textContent = siteTitle;
  });

  // --- 3) logos ----------------------------------------------------------
  // Prefer Westo cyan brand wordmark over legacy drink-era / gold logos
  var BRAND_WORDMARK = 'assets/images/brand/westo-wordmark.png?v=brandCyan2';
  function isLegacyLogo(path) {
    var p = String(path || '');
    if (!p) return true;
    if (/ciao/i.test(p)) return true;
    if (/westo-logo\.png/i.test(p)) return true;
    if (/6a0af6aee3ae4c7c923b77ca_westo_logo/i.test(p)) return true;
    if (/westo_logo(?:-black)?\.svg/i.test(p)) return true;
    // Only trust paths under brand/ (or explicitly uploaded media that isn't the old gold asset)
    if (/\/brand\//.test(p) || /assets\/images\/brand\//.test(p)) return false;
    // Old hashed webflow logos / warm assets outside brand/
    if (/assets\/images\/6a0/i.test(p)) return true;
    return false;
  }
  var whiteLogo = content['logo.white'] || '';
  var blackLogo = content['logo.black'] || '';
  if (isLegacyLogo(whiteLogo)) whiteLogo = BRAND_WORDMARK;
  if (isLegacyLogo(blackLogo)) blackLogo = BRAND_WORDMARK;
  content['logo.white'] = whiteLogo;
  content['logo.black'] = blackLogo;

  // The old implementation queried every <img> six separate times. Resolve
  // all legacy aliases in one pass; match against the original src so the
  // replacement order cannot cascade.
  Array.prototype.forEach.call(document.images || [], function (img) {
    var src = img.getAttribute('src') || '';
    var replacement = '';
    if (src.indexOf('Ciao-Energy_logo-black.svg') !== -1) replacement = blackLogo;
    else if (src.indexOf('Ciao-Energy_logo.svg') !== -1) replacement = whiteLogo;
    else if (src.indexOf('westo_logo-black.svg') !== -1) replacement = blackLogo;
    else if (src.indexOf('westo_logo.svg') !== -1) replacement = whiteLogo;
    else if (src.indexOf('6a0af6aee3ae4c7c923b77ca_westo_logo.svg') !== -1) replacement = whiteLogo;
    else if (src.indexOf('westo-logo.png') !== -1) replacement = whiteLogo;
    if (replacement) img.src = replacement;
  });
  var DARK_WORDMARK = 'assets/images/brand/westo-fa-wordmark-dark.png?v=brandDark1';
  var LIGHT_WORDMARK = 'assets/images/brand/westo-fa-wordmark.png?v=brandLight1';
  var ENTRANCE_MARK = content['entrance.logo'] || 'assets/images/brand/westo-mark.png?v=brandCyan2';
  var ENTRANCE_WORDMARK_DARK = content['entrance.wordmark.dark'] || LIGHT_WORDMARK;
  var ENTRANCE_WORDMARK_LIGHT = content['entrance.wordmark.light'] || DARK_WORDMARK;
  function updateBrandWordmarks(theme) {
    // Main header/menu retain the approved theme-aware Persian lockup.
    var src = theme === 'light' ? DARK_WORDMARK : LIGHT_WORDMARK;
    document.querySelectorAll('.navbar_logo, .auth-logo, #brand-logo, .navbar_menu-logo').forEach(function (img) {
      img.src = src;
      img.alt = 'Westo';
    });
    // Entrance media is separately admin-editable for each theme.
    document.querySelectorAll('#westo-entrance .eg-brand-wordmark-img, #westo-entrance [data-admin-media="entrance.wordmark"]').forEach(function (img) {
      img.src = theme === 'light' ? ENTRANCE_WORDMARK_LIGHT : ENTRANCE_WORDMARK_DARK;
      img.alt = 'Westo';
    });
  }
  document.querySelectorAll('#westo-entrance .eg-logo, #westo-entrance .eg-logo-png, #westo-entrance .loader_logo').forEach(function (img) {
    img.src = ENTRANCE_MARK;
    img.alt = 'Westo';
  });
  function applyEntranceContent() {
    document.querySelectorAll('#westo-entrance [data-admin-content]').forEach(function (el) {
      var key = el.getAttribute('data-admin-content');
      var value = content[key];
      if (typeof value === 'string' && value.trim()) el.textContent = value;
    });
  }
  updateBrandWordmarks(document.documentElement.getAttribute('data-theme'));
  applyEntranceContent();
  window.addEventListener('westo:theme-change', function (event) {
    updateBrandWordmarks(event.detail && event.detail.theme);
  });
  // i18n dispatches this event on document (non-bubbling), so listen on the
  // actual owner instead of window; this keeps Admin entrance copy authoritative.
  document.addEventListener('westo:langchange', applyEntranceContent);
  var brandTitle = document.getElementById('eg-brand-wordmark') || document.getElementById('eg-brand-name');
  if (brandTitle && !brandTitle.querySelector('img')) {
    brandTitle.innerHTML = '<img class="eg-brand-wordmark-img" data-admin-media="entrance.wordmark" src="' + ENTRANCE_WORDMARK_DARK + '" alt="Westo" />';
  }
  var navbarMenu = document.querySelector('.navbar_menu');
  if (navbarMenu) {
    var menuTextWalker = document.createTreeWalker(navbarMenu, NodeFilter.SHOW_TEXT);
    var menuTextNode;
    while ((menuTextNode = menuTextWalker.nextNode())) {
      var parent = menuTextNode.parentNode;
      if (parent && parent.childNodes.length === 1) {
        menuTextNode.nodeValue = menuTextNode.nodeValue.replace(/CIAO\s+ENERGY/gi, 'WESTO');
      }
    }
  }

  // --- 4) carousel slides from menu categories (same order as 3D cans) ---
  // Prefer siteCategories (cover + visibility applied server-side).
  function hasCover(c) {
    var cover = String((c && c.coverImg) || '').trim();
    return !!cover && !/assets\/textures\/westo_texture_/i.test(cover);
  }
  function buildCarouselProducts() {
    var siteCats = data.siteCategories;
    if (Array.isArray(siteCats) && siteCats.length) {
      return siteCats.filter(hasCover).map(function (c) {
        var title = String(c.title || '').trim();
        return {
          id: c.id,
          menuCategoryId: c.id,
          title: title,
          name1: title,
          name2: '',
          shortDesc: c.shortDesc || '',
          longDesc: c.longDesc || '',
          coverImg: c.coverImg || '',
        };
      });
    }
    if (Array.isArray(products) && products.length && products[0] && products[0].menuCategoryId != null) {
      return products.map(function (p) {
        var title = String(p.title || p.name1 || '').trim();
        return Object.assign({}, p, { title: title, name1: title, name2: '' });
      });
    }
    return (data.menuCategories || [])
      .filter(function (c) {
        return c && !c.hiddenOnSite && hasCover(c);
      })
      .map(function (c) {
        var title = String(c.title || '').trim();
        return {
          id: c.id,
          menuCategoryId: c.id,
          title: title,
          name1: title,
          name2: '',
          shortDesc: c.shortDesc || '',
          longDesc: c.longDesc || '',
          coverImg: c.coverImg || '',
        };
      });
  }
  products = buildCarouselProducts();
  if (typeof data.menuRevision === 'number') {
    window.__westoMenuRevision = data.menuRevision;
  }
  window.__westoSlideCategoryOrder = products.map(function (p) {
    return Number(p.menuCategoryId);
  });
  // Slides differ per list: hero uses .carousel_slide, the desc lists use
  // .carousel_desc / .carousel_title-b — so walk direct children instead.
  // Each list is grown by cloning so there is one slide per active category.
  // Taste colors are keyed by stable categoryId via westoCategoryTheme.
  document.querySelectorAll('.carousel_list').forEach(function (list) {
    var isHero = list.classList.contains('is-hero');
    if (!list.children.length || !products.length) return;
    while (list.children.length < products.length) {
      list.appendChild(list.children[0].cloneNode(true));
    }
    while (list.children.length > products.length) {
      list.removeChild(list.lastElementChild);
    }
    Array.prototype.forEach.call(list.children, function (slide, i) {
      var p = products[i];
      if (!p) {
        slide.style.display = 'none';
        return;
      }
      slide.style.display = '';
      if (p.menuCategoryId != null) slide.setAttribute('data-menu-cat-id', String(p.menuCategoryId));
      if (p.coverImg) slide.setAttribute('data-cover-img', String(p.coverImg));
      var spans = slide.querySelectorAll('[data-anim="chars-mask"]');
      var faTitle = String(p.title || p.name1 || '')
        .replace(/\s+/g, ' ')
        .trim();
      slide.setAttribute('data-cat-fa', faTitle);
      if (p.shortDesc) slide.setAttribute('data-cat-desc-fa', p.shortDesc);
      if (p.longDesc) slide.setAttribute('data-cat-long-fa', p.longDesc);
      var titleRoot = slide.querySelector('.heading-style-h2') || slide;
      var br = titleRoot.querySelector('br');
      var displayTitle = faTitle;
      if (window.westoI18n && typeof window.westoI18n.catTitleFromFa === 'function') {
        displayTitle = window.westoI18n.catTitleFromFa(faTitle) || faTitle;
      }
      if (spans[0] && spans[1]) {
        spans[0].textContent = displayTitle;
        spans[1].textContent = '';
        spans[1].style.display = 'none';
        if (br) br.style.display = 'none';
      } else if (spans[0]) {
        spans[0].textContent = displayTitle;
      }
      var longDesc = slide.querySelector('.profile_desc p');
      if (longDesc) {
        longDesc.textContent = p.longDesc;
      } else if (isHero) {
        var shortDesc = slide.querySelector('p');
        if (shortDesc) shortDesc.textContent = p.shortDesc;
      }
      var tasteApi = window.westoCategoryTheme;
      var taste = tasteApi && typeof tasteApi.tasteFor === 'function'
        ? tasteApi.tasteFor(p.menuCategoryId)
        : null;
      if (taste) {
        slide.dataset.tastePrimary = taste.primary;
        slide.dataset.tasteSecondary = taste.secondary;
        if (taste.slug) slide.dataset.catSlug = taste.slug;
      }
    });
  });

  if (window.westoI18n && typeof window.westoI18n.localizeHeroTitles === 'function') {
    window.westoI18n.localizeHeroTitles();
  }

  // --- 5) FAQ (rebuild list from API so add/remove/reorder works) --------
  var faqList = document.querySelector('.faq_list');
  if (faqList && faq.length) {
    var items = faqList.querySelectorAll(':scope > .w-dyn-item');
    if (items.length) {
      var template = items[0];
      // grow / shrink to match. Track the count locally instead of
      // re-running a scoped selector after every clone.
      var itemCount = items.length;
      while (itemCount < faq.length) {
        faqList.appendChild(template.cloneNode(true));
        itemCount += 1;
      }
      var current = faqList.querySelectorAll(':scope > .w-dyn-item');
      current.forEach(function (item, i) {
        if (i >= faq.length) { item.remove(); return; }
        var q = item.querySelector('.faq_question .heading-style-h5');
        var a = item.querySelector('.faq_answer p');
        if (q) q.textContent = faq[i].q;
        if (a) a.textContent = faq[i].a;
      });
    }
  }


  // --- 5.1) FAQ accordion keyboard + aria-expanded --------------------
  function enhanceFaqA11y() {
    document.querySelectorAll('.section.is-faq .faq_accordion').forEach(function (acc) {
      var q = acc.querySelector('.faq_question');
      var a = acc.querySelector('.faq_answer');
      if (!q || !a || q.dataset.a11yBound) return;
      q.dataset.a11yBound = '1';
      q.setAttribute('role', 'button');
      q.setAttribute('tabindex', '0');
      function sync() {
        var h = a.style.height;
        var open = h && h !== '0px';
        q.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      sync();
      q.addEventListener('click', function () {
        requestAnimationFrame(function () { setTimeout(sync, 400); });
      });
      q.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          q.click();
        }
      });
    });
  }
  enhanceFaqA11y();

  // Cafe menu story: prefer category wording over drink-era «محصولات»
  document.querySelectorAll('a.navbar_link[href="#gamme"]').forEach(function (a) {
    if ((a.textContent || '').trim() === 'محصولات') a.textContent = 'دسته‌ها';
  });
  function paintGuestChrome() {
    if (!window.westoI18n || !window.westoI18n.t) return;
    if (typeof window.westoI18n.paintStaticI18n === 'function') {
      window.westoI18n.paintStaticI18n();
    }
    var scrollHint = document.querySelector('.scroll_discover');
    if (scrollHint) {
      scrollHint.textContent = window.westoI18n.t('hero.scroll');
      var spread = Math.max(28, (scrollHint.textContent || '').trim().length * 2);
      scrollHint.style.setProperty('--shimmer-spread', spread + 'px');
    }
    document.querySelectorAll('a.navbar_link[href="#gamme"] .navbar_link-label').forEach(function (label) {
      label.textContent = window.westoI18n.t('nav.categories');
    });
    var menuLabel = document.querySelector('.navbar_menu-button .text-block');
    if (menuLabel) menuLabel.textContent = window.westoI18n.t('nav.menu');
    var auth = document.querySelector('#nav-auth-btn div');
    if (auth) auth.textContent = window.westoI18n.t('nav.login');
  }
  paintGuestChrome();
  document.addEventListener('westo:langchange', paintGuestChrome);

  // --- 5.5) dish boards are populated from the shared model in table-cart.js ---

  // --- 6) newsletter form → local API (Brevo removed) --------------------
  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('sib-form');
    if (!form) return;
    var success = document.getElementById('success-message');
    var error = document.getElementById('error-message');
    function panel(el, show) {
      if (!el) return;
      el.style.display = show ? 'inline-block' : 'none';
      if (show) el.classList.add('sib-form-message-panel--active');
      else el.classList.remove('sib-form-message-panel--active');
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var email = (form.querySelector('#EMAIL') || {}).value || '';
      fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function () { panel(error, false); panel(success, true); form.reset(); })
        .catch(function () { panel(success, false); panel(error, true); });
    }, true);
  });
})();

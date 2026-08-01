/* EduLift shared page utility: default metadata, GA tracking wrapper, event hooks. */
(function () {
  'use strict';

  var root = document.documentElement;

  function gtagAvailable() {
    return typeof window.gtag === 'function';
  }

  function setMeta(attr, key, content) {
    var el = document.querySelector('meta[' + attr + '="' + key + '"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  function setCanonical(href) {
    var el = document.querySelector('link[rel="canonical"]');
    if (!el) {
      el = document.createElement('link');
      el.setAttribute('rel', 'canonical');
      document.head.appendChild(el);
    }
    el.setAttribute('href', href);
  }

  function defaultsFromMeta() {
    var meta = {};
    try {
      var script = document.getElementById('edulift-meta');
      if (script && script.type === 'application/json') {
        meta = JSON.parse(script.textContent);
      }
    } catch (e) {
      meta = {};
    }
    return meta;
  }

  function init() {
    var meta = defaultsFromMeta();

    if (meta.canonical) {
      setCanonical(meta.canonical);
      if (!document.querySelector('meta[property="og:url"]')) {
        setMeta('property', 'og:url', meta.canonical);
      }
    }
    if (meta.title) {
      if (document.title !== meta.title) document.title = meta.title;
      setMeta('property', 'og:title', meta.title);
      setMeta('name', 'twitter:title', meta.title);
    }
    if (meta.description) {
      setMeta('name', 'description', meta.description);
      setMeta('property', 'og:description', meta.description);
      setMeta('name', 'twitter:description', meta.description);
    }
    if (meta.image) {
      setMeta('property', 'og:image', meta.image);
      setMeta('name', 'twitter:image', meta.image);
    }
    if (meta.siteName) setMeta('property', 'og:site_name', meta.siteName);
    if (meta.type) setMeta('property', 'og:type', meta.type);
    if (meta.themeColor) {
      var theme = document.querySelector('meta[name="theme-color"]');
      if (theme) theme.setAttribute('content', meta.themeColor);
    }

    root.classList.add('js-ready');

    hook('[data-track]', function (el) {
      return el.getAttribute('data-track');
    });
  }

  function track(eventName, params) {
    params = params || {};
    try {
      if (gtagAvailable()) {
        window.gtag('event', eventName, params);
      } else {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: eventName });
      }
    } catch (e) {
      /* analytics must never break the sim */
    }
  }

  function onReady(fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(fn, 0);
    } else {
      document.addEventListener('DOMContentLoaded', fn);
    }
  }

  function hook(selector, eventName, params, eventType) {
    onReady(function () {
      var els = document.querySelectorAll(selector);
      Array.prototype.forEach.call(els, function (el) {
        el.addEventListener(eventType || 'click', function () {
          var name = typeof eventName === 'function' ? eventName(el) : eventName;
          track(name, typeof params === 'function' ? params(el) : params);
        });
      });
    });
  }

  window.EduLift = {
    init: init,
    track: track,
    hook: hook,
    onReady: onReady,
    meta: defaultsFromMeta,
  };

  init();
})();

/*
 * Connects the app to the Apps Script API and recreates google.script.run on
 * top of fetch, so the page code written for Apps Script runs unchanged.
 *
 * Speed: every Apps Script call costs ~0.5-2 s of Google start-up time, so the
 * app makes as few calls as possible and hides the rest:
 *   - Read results are kept on the phone. A screen shows saved data instantly,
 *     refreshes it in the background, and redraws only if something changed.
 *   - Results younger than 30 s aren't re-fetched at all (fast tab switching).
 *   - At launch, all first-screen data loads in ONE batched request.
 *   - Any successful change clears the saved data, so nothing stale survives
 *     a write. Refresh buttons bypass every cache.
 * The web app URL and key are stored only in this device's localStorage.
 */
(function () {
  'use strict';

  var URL_KEY = 'wt.apiUrl';
  var KEY_KEY = 'wt.apiKey';
  var LC_PREFIX = 'wt.c.';
  var FRESH_MS = 30000;
  var URL_PATTERN = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+|macros)\/s\/[^/]+\/exec$/;
  var CACHEABLE = { getCSPList: 1, getDashboardData: 1, getDrilldown: 1, getOpenPositions: 1 };
  var WRITES = { addCSP: 1, addCC: 1, setCSPStatus: 1, setCCStatus: 1, addDividend: 1 };

  var readyCb = null;
  var forceFresh = false;   // set only while a Refresh handler runs
  var inflight = {};        // cache key -> pending promise (dedupes launch prefetch)

  function $(id) { return document.getElementById(id); }
  function read(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  function isConfigured() { return !!(read(URL_KEY) && read(KEY_KEY)); }

  /* ---------- on-device result cache ---------- */
  function lcKey(action, args) { return LC_PREFIX + action + '|' + JSON.stringify(args || []); }
  function lcGet(k) {
    try { var raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function lcPut(k, result) {
    try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), s: JSON.stringify(result) })); }
    catch (e) { lcClear(); } // storage full: start over rather than fail
  }
  function lcClear() {
    try {
      var ks = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(LC_PREFIX) === 0) ks.push(k);
      }
      ks.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* ignore */ }
  }

  /* ---------- transport ---------- */
  /**
   * POST a JSON payload with the key added. Sent as text/plain so the browser
   * makes a "simple" cross-origin request (no CORS preflight, which Apps
   * Script does not answer). `override` lets the setup screen test
   * credentials before saving them.
   */
  function post(payload, override) {
    var url = override ? override.url : read(URL_KEY);
    var key = override ? override.key : read(KEY_KEY);
    if (!url || !key) return Promise.reject(new Error('App not connected. Open Settings.'));
    payload.key = key;

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('Server returned ' + res.status + '.');
      return res.json().catch(function () {
        throw new Error('Unexpected response. Check the web app URL.');
      });
    }, function () {
      throw new Error('Can\u2019t reach your tracker. Check your connection and that the deployment\u2019s access is set to Anyone.');
    }).then(function (body) {
      if (!body || body.ok !== true) {
        var msg = (body && body.error) || 'Request failed.';
        if (msg === 'Invalid app key.' && !override) showSetup('Your app key was rejected. Enter the current key.');
        throw new Error(msg);
      }
      return body;
    });
  }

  function call(action, args, override, fresh) {
    var payload = { action: action, args: args || [] };
    if (fresh) payload.fresh = true;
    return post(payload, override).then(function (body) { return body.result; });
  }

  /**
   * Load the first-screen data in one request and keep each result on the
   * phone. Screens that ask for the same data while it's loading share this
   * request instead of starting their own. If the server predates batching,
   * each item quietly falls back to its own request.
   */
  function prefetch(filter) {
    var items = [
      { action: 'getCSPList', args: [] },
      { action: 'getOpenPositions', args: ['CSP', false] },
      { action: 'getOpenPositions', args: ['CC', false] },
      { action: 'getDashboardData', args: [filter || { year: '', month: '' }] }
    ];
    var batch = post({ batch: items });
    items.forEach(function (it, i) {
      var k = lcKey(it.action, it.args);
      var p = batch.then(function (body) {
        var r = body.results && body.results[i];
        if (!r || !r.ok) throw new Error((r && r.error) || 'Request failed.');
        return r.result;
      }).catch(function () { return call(it.action, it.args); });
      inflight[k] = p;
      p.then(function (result) { lcPut(k, result); }, function () {})
       .then(function () { if (inflight[k] === p) delete inflight[k]; });
    });
    return batch.then(function () {}, function () {});
  }

  function notify(msg) {
    if (typeof window.toast === 'function') window.toast(msg, '');
  }

  /* ---------- google.script.run shim ---------- */
  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') return function (f) { return runner(f, fail); };
        if (prop === 'withFailureHandler') return function (f) { return runner(ok, f); };
        if (typeof prop !== 'string') return undefined;
        return function () {
          var args = Array.prototype.slice.call(arguments);
          var fresh = forceFresh;
          function deliver(r) { if (ok) { try { ok(r); } catch (e) { console.error(e); } } }
          function failWith(e) { if (fail) fail(e); else console.error(e); }

          if (!CACHEABLE[prop]) {
            call(prop, args, null, fresh).then(function (r) {
              if (WRITES[prop]) lcClear();   // saved views are now out of date
              deliver(r);
            }, failWith);
            return;
          }

          var k = lcKey(prop, args);
          var hit = fresh ? null : lcGet(k);
          if (hit && Date.now() - hit.t < FRESH_MS) {
            // Recent enough: show it and skip the call entirely.
            var recent = JSON.parse(hit.s);
            Promise.resolve().then(function () { deliver(recent); });
            return;
          }
          // Show saved data right away, then refresh. `settled` guarantees the
          // saved copy can never be drawn over a newer server result.
          var saved = hit ? JSON.parse(hit.s) : null;
          var settled = false, showedSaved = false;
          if (hit) {
            Promise.resolve().then(function () {
              if (!settled) { showedSaved = true; deliver(saved); }
            });
          }
          var net = (!fresh && inflight[k]) || call(prop, args, null, fresh);
          net.then(function (r) {
            settled = true;
            var s = JSON.stringify(r);
            lcPut(k, r);
            if (!showedSaved || hit.s !== s) deliver(r);   // redraw only on change
          }, function (e) {
            settled = true;
            if (hit) {
              if (!showedSaved) deliver(saved);
              notify('Showing saved data. ' + e.message);
            } else {
              failWith(e);
            }
          });
        };
      }
    });
  }
  window.google = { script: { run: runner(null, null) } };

  /** Run a load function with every cache bypassed (used by Refresh buttons). */
  function fresh(fn) {
    forceFresh = true;
    try { fn(); } finally { forceFresh = false; }
  }

  /* ---------- setup screen ---------- */
  function setStatus(msg, kind) {
    var el = $('setupStatus');
    el.textContent = msg || '';
    el.className = 'setup-status' + (kind ? ' ' + kind : '');
  }

  function showSetup(msg) {
    $('setupUrl').value = read(URL_KEY);
    $('setupKey').value = read(KEY_KEY);
    $('btnSetupCancel').classList.toggle('hidden', !isConfigured());
    setStatus(msg || '', msg ? 'err' : '');
    $('setup').classList.remove('hidden');
  }

  function hideSetup() { $('setup').classList.add('hidden'); }

  function saveSetup() {
    var url = $('setupUrl').value.trim();
    var key = $('setupKey').value.trim();
    if (!URL_PATTERN.test(url)) { setStatus('Paste the web app URL that ends in /exec.', 'err'); return; }
    if (!key) { setStatus('Enter the app key.', 'err'); return; }

    var btn = $('btnSetup');
    btn.disabled = true; btn.textContent = 'Connecting\u2026';
    setStatus('');
    call('ping', [], { url: url, key: key }).then(function () {
      var changed = url !== read(URL_KEY) || key !== read(KEY_KEY);
      write(URL_KEY, url);
      write(KEY_KEY, key);
      if (changed) lcClear();   // saved data may belong to a different sheet
      btn.disabled = false; btn.textContent = 'Connect';
      hideSetup();
      if (readyCb) readyCb();
    }, function (err) {
      btn.disabled = false; btn.textContent = 'Connect';
      setStatus(err.message, 'err');
    });
  }

  function onReady(cb) {
    readyCb = cb;
    if (isConfigured()) cb(); else showSetup();
  }

  /* ---------- offline app shell ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* app still works online */ });
    });
  }

  window.Api = {
    call: call, isConfigured: isConfigured, onReady: onReady, prefetch: prefetch, fresh: fresh,
    showSetup: showSetup, hideSetup: hideSetup, saveSetup: saveSetup
  };
})();

/*
 * Connects the app to the Apps Script API and recreates google.script.run on
 * top of fetch, so the page code written for Apps Script runs unchanged.
 * The web app URL and key are stored only in this device's localStorage.
 */
(function () {
  'use strict';

  var URL_KEY = 'wt.apiUrl';
  var KEY_KEY = 'wt.apiKey';
  var URL_PATTERN = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+|macros)\/s\/[^/]+\/exec$/;
  var readyCb = null;

  function $(id) { return document.getElementById(id); }
  function read(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  function isConfigured() { return !!(read(URL_KEY) && read(KEY_KEY)); }

  /**
   * POST {key, action, args} to the API. Sent as text/plain so the browser
   * makes a "simple" cross-origin request (no CORS preflight, which Apps
   * Script does not answer). `override` is used by the setup screen to test
   * credentials before saving them.
   */
  function call(action, args, override) {
    var url = override ? override.url : read(URL_KEY);
    var key = override ? override.key : read(KEY_KEY);
    if (!url || !key) return Promise.reject(new Error('App not connected. Open Settings.'));

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: key, action: action, args: args || [] }),
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
      return body.result;
    });
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
          call(prop, args).then(
            function (result) { if (ok) { try { ok(result); } catch (e) { console.error(e); } } },
            function (err) { if (fail) fail(err); else console.error(err); }
          );
        };
      }
    });
  }
  window.google = { script: { run: runner(null, null) } };

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
      write(URL_KEY, url);
      write(KEY_KEY, key);
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
    call: call, isConfigured: isConfigured, onReady: onReady,
    showSetup: showSetup, hideSetup: hideSetup, saveSetup: saveSetup
  };
})();

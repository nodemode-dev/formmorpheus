/* Pen Link companion: pairs with the desktop, sends pen samples, shows the mirrored canvas. No dependencies. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var pairEl = $('pair'), liveEl = $('live'), codeEl = $('code'), errEl = $('err'), statusEl = $('status');
  var surface = $('surface'), mirror = $('mirror'), ink = $('ink');
  var mctx = mirror.getContext('2d'), ictx = ink.getContext('2d');

  var token = '', ws = null, aspect = 16 / 9, seq = 0, latency = 0, retryUntil = 0, closing = false;
  var erase = false, dragging = false, inkClearAt = 0, penDown = false;

  try { document.addEventListener('contextmenu', function (e) { e.preventDefault(); }); } catch (x) { /* none */ }
  ['gesturestart', 'gesturechange', 'gestureend', 'dblclick'].forEach(function (n) { document.addEventListener(n, function (e) { e.preventDefault(); }, { passive: false }); });
  document.addEventListener('touchmove', function (e) { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }, { passive: false });
  document.addEventListener('selectstart', function (e) { if (e.target !== codeEl) e.preventDefault(); });

  // ------------------------------------------------------------------ pairing
  function fail(m) { errEl.textContent = m; }
  function pair() {
    var code = codeEl.value.replace(/\D/g, '');
    if (code.length !== 6) { fail('Type all 6 digits.'); return; }
    fail('');
    fetch('pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code, device: deviceName() }) })
      .then(function (r) {
        if (r.status === 200) return r.json().then(function (j) { token = j.token; openSocket(); });
        if (r.status === 401) { fail('That code is wrong.'); return undefined; }
        return r.text().then(function (t) { fail(t || 'Could not pair.'); });
      })
      .catch(function () { fail('Could not reach the computer.'); });
  }
  function deviceName() {
    // a generic label: the desktop shows it as the paired device
    var touch = navigator.maxTouchPoints > 1;
    return touch ? 'Tablet' : 'Browser';
  }
  $('go').addEventListener('click', pair);
  codeEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') pair(); });
  codeEl.addEventListener('input', function () { codeEl.value = codeEl.value.replace(/\D/g, '').slice(0, 6); });

  // ------------------------------------------------------------------ socket
  function setStatus(text, ok) { statusEl.textContent = text; statusEl.className = 'status' + (ok ? ' ok' : ''); }
  function send(o) { if (ws && ws.readyState === 1) ws.send(typeof o === 'string' || o instanceof ArrayBuffer ? o : JSON.stringify(o)); }
  function openSocket() {
    closing = false;
    var s = new WebSocket('ws://' + location.host + '/penlink/ws');
    s.binaryType = 'arraybuffer';
    ws = s;
    s.onopen = function () { s.send(JSON.stringify({ t: 'hello', token: token })); };
    s.onmessage = function (ev) {
      if (typeof ev.data === 'string') return onText(JSON.parse(ev.data));
      onFrame(ev.data);
    };
    s.onclose = function (ev) {
      if (ws !== s) return;
      ws = null;
      if (closing) return;
      if (ev.code === 1008 && liveEl.hidden) { toPair('The pairing was refused. Ask for a new code.'); return; }
      if (!retryUntil) retryUntil = Date.now() + 30000;
      if (Date.now() > retryUntil) { toPair('The connection was lost. Ask for a new code.'); return; }
      setStatus('Reconnecting', false);
      setTimeout(openSocket, 1000);
    };
  }
  function toPair(msg) {
    token = ''; retryUntil = 0; closing = true;
    if (ws) { try { ws.close(); } catch (x) { /* none */ } }
    liveEl.hidden = true; pairEl.hidden = false; fail(msg || '');
  }
  function onText(m) {
    if (m.t === 'ok') {
      retryUntil = 0;
      pairEl.hidden = true; liveEl.hidden = false;
      setStatus('Connected', true);
      layout(); sendView(); startPing(); wake();
    } else if (m.t === 'pong') {
      latency = Math.round(performance.now() - m.ts);
      setStatus('Connected · ' + latency + ' ms', true);
      send({ t: 'lat', ms: latency });
    } else if (m.t === 'state') {
      if (m.w && m.h && Math.abs(m.w / m.h - aspect) > 0.001) { aspect = m.w / m.h; layout(); sendView(); }
      if (!dragging) {
        erase = !!m.erase; syncTool();
        if (typeof m.size === 'number') $('size').value = Math.round(m.size * 1000);
        if (typeof m.opacity === 'number') $('opacity').value = Math.round(m.opacity * 1000);
      }
    } else if (m.t === 'bye') {
      toPair('The computer ended the session.');
    }
  }
  var pingTimer = 0;
  function startPing() {
    clearInterval(pingTimer);
    pingTimer = setInterval(function () { send({ t: 'ping', ts: performance.now() }); }, 2000);
    send({ t: 'ping', ts: performance.now() });
  }
  function wake() { try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(function () {}); } catch (x) { /* none */ } }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && token) wake(); });

  // ------------------------------------------------------------------ mirror
  var busy = false;
  function onFrame(buf) {
    var v = new DataView(buf);
    if (v.getUint8(0) !== 2) return;
    var fseq = v.getUint16(2, true);
    var blob = new Blob([buf.slice(4)], { type: v.getUint8(1) === 0 ? 'image/webp' : 'image/jpeg' });
    send({ t: 'ack', seq: fseq });
    if (busy) return;
    busy = true;
    createImageBitmap(blob).then(function (bmp) {
      mctx.drawImage(bmp, 0, 0, mirror.width, mirror.height);
      if (bmp.close) bmp.close();
      if (!penDown && inkClearAt && performance.now() > inkClearAt) { ictx.clearRect(0, 0, ink.width, ink.height); inkClearAt = 0; }
    }).catch(function () { /* a bad frame is skipped */ }).then(function () { busy = false; });
  }

  var fit = { w: 0, h: 0, dpr: 1 };
  function layout() {
    var sw = surface.clientWidth, sh = surface.clientHeight;
    if (!sw || !sh) return;
    var w = sw, h = sw / aspect;
    if (h > sh) { h = sh; w = sh * aspect; }
    w = Math.floor(w); h = Math.floor(h);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    [mirror, ink].forEach(function (c) {
      c.style.width = w + 'px'; c.style.height = h + 'px';
      c.style.left = Math.floor((sw - w) / 2) + 'px'; c.style.top = Math.floor((sh - h) / 2) + 'px';
      if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    });
    fit = { w: w, h: h, dpr: dpr };
  }
  var viewTimer = 0;
  function sendView() {
    clearTimeout(viewTimer);
    viewTimer = setTimeout(function () { send({ t: 'view', w: mirror.width, h: mirror.height }); }, 80);
  }
  window.addEventListener('resize', function () { layout(); sendView(); });

  // ------------------------------------------------------------------ toolbar
  function syncTool() { $('brush').classList.toggle('on', !erase); $('eraser').classList.toggle('on', erase); }
  function sendTool() { send({ t: 'tool', erase: erase, size: $('size').value / 1000, opacity: $('opacity').value / 1000 }); }
  $('brush').addEventListener('click', function () { erase = false; syncTool(); send({ t: 'tool', erase: false }); });
  $('eraser').addEventListener('click', function () { erase = true; syncTool(); send({ t: 'tool', erase: true }); });
  $('undo').addEventListener('click', function () { send({ t: 'undo' }); });
  $('redo').addEventListener('click', function () { send({ t: 'redo' }); });
  ['size', 'opacity'].forEach(function (id) {
    var el = $(id);
    el.addEventListener('pointerdown', function () { dragging = true; });
    el.addEventListener('input', function () { send({ t: 'tool', size: $('size').value / 1000, opacity: $('opacity').value / 1000 }); });
    var done = function () { setTimeout(function () { dragging = false; }, 300); };
    el.addEventListener('pointerup', done); el.addEventListener('pointercancel', done);
  });

  // ------------------------------------------------------------------ pen samples
  var F_DOWN = 1, F_UP = 2, F_HOVER = 4, F_ERASER = 8, F_BARREL = 16, F_ENTER = 32, F_LEAVE = 64;
  var penId = 0, hovering = false, lastT = 0, last = null;

  function angles(e) {
    var alt = e.altitudeAngle, az = e.azimuthAngle;
    if (typeof alt !== 'number' || typeof az !== 'number') {
      var tx = Math.tan((e.tiltX || 0) * Math.PI / 180), ty = Math.tan((e.tiltY || 0) * Math.PI / 180), m = Math.hypot(tx, ty);
      alt = m ? Math.atan(1 / m) : Math.PI / 2;
      az = m ? (Math.atan2(ty, tx) + 2 * Math.PI) % (2 * Math.PI) : 0;
    }
    return [alt, az];
  }

  function pack(list, flagsFor) {
    // header: u8 type 1, u8 count, u16 seq; then 20 bytes a sample (see HASHOUT_LOG v0.15.0)
    var r = surface.firstElementChild.getBoundingClientRect();
    var n = Math.min(list.length, 16);
    var buf = new ArrayBuffer(4 + n * 20), v = new DataView(buf);
    v.setUint8(0, 1); v.setUint8(1, n); v.setUint16(2, seq++ & 0xffff, true);
    for (var i = 0; i < n; i++) {
      var e = list[i], o = 4 + i * 20, t = e.timeStamp || performance.now();
      var a = angles(e);
      v.setUint16(o, Math.min(65535, Math.max(0, Math.round(t - (lastT || t)))), true); lastT = t;
      v.setFloat32(o + 2, (e.clientX - r.left) / r.width, true);
      v.setFloat32(o + 6, (e.clientY - r.top) / r.height, true);
      var p = e.pointerType === 'mouse' ? (e.buttons ? 0.5 : 0) : e.pressure;
      v.setUint16(o + 10, Math.round(Math.max(0, Math.min(1, p)) * 65535), true);
      v.setInt8(o + 12, Math.max(-90, Math.min(90, Math.round(e.tiltX || 0))));
      v.setInt8(o + 13, Math.max(-90, Math.min(90, Math.round(e.tiltY || 0))));
      v.setUint16(o + 14, Math.round(Math.max(0, Math.min(359.9, e.twist || 0)) * 10), true);
      v.setUint8(o + 16, flagsFor(e, i));
      v.setUint8(o + 17, 1);
      v.setUint8(o + 18, Math.round(Math.max(0, Math.min(1, a[0] / (Math.PI / 2))) * 255));
      v.setUint8(o + 19, Math.round(Math.max(0, Math.min(1, a[1] / (2 * Math.PI))) * 255));
    }
    return buf;
  }

  function flags(e, base) {
    var f = base;
    if (e.pointerType === 'pen' && (e.buttons & 32)) f |= F_ERASER;
    if (e.buttons & 2) f |= F_BARREL;
    return f;
  }
  function emit(events, base) {
    for (var i = 0; i < events.length; i += 16) {
      var chunk = events.slice(i, i + 16);
      send(pack(chunk, function (e) { return flags(e, base); }));
    }
  }

  function drawInk(a, b) {
    if (erase || !last) return;
    var r = mirror.getBoundingClientRect();
    var k = ink.width / r.width;
    var op = $('opacity').value / 1000, size = $('size').value / 1000;
    var base = 2 + size * 30;
    ictx.lineCap = 'round';
    ictx.strokeStyle = 'rgba(247,247,247,' + (0.35 + 0.5 * op).toFixed(2) + ')';
    ictx.lineWidth = Math.max(1, base * (0.2 + 0.8 * b.pressure) * k);
    ictx.beginPath();
    ictx.moveTo((a.clientX - r.left) * k, (a.clientY - r.top) * k);
    ictx.lineTo((b.clientX - r.left) * k, (b.clientY - r.top) * k);
    ictx.stroke();
  }

  function isDraw(e) { return e.pointerType === 'pen' || e.pointerType === 'mouse'; }

  surface.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch') return touchDown(e);
    if (!isDraw(e) || penDown) return;
    e.preventDefault();
    penDown = true; penId = e.pointerId;
    try { surface.setPointerCapture(e.pointerId); } catch (x) { /* none */ }
    last = e;
    inkClearAt = 0;
    emit([e], F_DOWN);
  });
  surface.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return touchMove(e);
    if (!isDraw(e)) return;
    e.preventDefault();
    var list = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    if (!list.length) list = [e];
    if (penDown && e.pointerId === penId) {
      for (var i = 0; i < list.length; i++) { drawInk(last, list[i]); last = list[i]; }
      emit(list, 0);
    } else if (!penDown && e.pointerType === 'pen') {
      if (!hovering) { hovering = true; emit([list[0]], F_HOVER | F_ENTER); if (list.length > 1) emit(list.slice(1), F_HOVER); }
      else emit(list, F_HOVER);
    }
  });
  function end(e, cancel) {
    if (e.pointerType === 'touch') return touchUp(e);
    if (!penDown || e.pointerId !== penId) return;
    penDown = false; last = null;
    emit([e], F_UP | (cancel ? F_LEAVE : 0));
    inkClearAt = performance.now() + 450;
  }
  surface.addEventListener('pointerup', function (e) { end(e, false); });
  surface.addEventListener('pointercancel', function (e) { end(e, true); });
  surface.addEventListener('pointerleave', function (e) {
    if (e.pointerType === 'pen' && hovering && !penDown) { hovering = false; emit([e], F_HOVER | F_LEAVE); }
  });

  // ------------------------------------------------------------------ fingers: two-finger tap undo, three-finger tap redo
  var touches = {}, tcount = 0, tmax = 0, tstart = 0, tmoved = false;
  function touchDown(e) {
    if (!tcount) { tstart = performance.now(); tmax = 0; tmoved = false; }
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    tcount++; tmax = Math.max(tmax, tcount);
  }
  function touchMove(e) {
    var t = touches[e.pointerId];
    if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 14) tmoved = true;
  }
  function touchUp(e) {
    if (!touches[e.pointerId]) return;
    delete touches[e.pointerId]; tcount--;
    if (tcount > 0) return;
    if (!tmoved && performance.now() - tstart < 400) {
      if (tmax === 2) send({ t: 'undo' });
      else if (tmax === 3) send({ t: 'redo' });
    }
    tmax = 0;
  }
})();

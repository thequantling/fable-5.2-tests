// Sound, made on the spot from noise and sine waves: fat hissing on hot bars, charcoal crackling,
// crickets somewhere in the dark. Nothing plays until the first tap, click or key press.
export function buildAudio({ fire, food }) {
  const btn = document.getElementById('b-sound');
  let ctx = null, out = null, white = null, brown = null, G = null, nextPop = 0, nextSpit = 0, muted = false;
  try { muted = localStorage.getItem('bbq-muted') === '1'; } catch (_) { /* storage may be blocked */ }
  function paint() {
    if (!btn) return;
    btn.querySelector('.on').style.display = muted ? 'none' : '';
    btn.querySelector('.off').style.display = muted ? '' : 'none';
    btn.setAttribute('aria-pressed', String(!muted));
  }

  function buffer(seconds, fill, channels = 1) {
    const b = ctx.createBuffer(channels, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    for (let c = 0; c < channels; c++) fill(b.getChannelData(c), c, ctx.sampleRate);
    return b;
  }
  const loop = (buf, rate = 1) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * buf.duration); return s; };
  const filter = (type, freq, q = 0.7) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; };
  const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; };

  function fillBrown(d) {                           // deep rumbling noise, cross-faded so that it loops without a click
    const n = d.length, f = Math.floor(n * 0.08), x = new Float32Array(n + f);
    let b = 0;
    for (let i = 0; i < n + f; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; x[i] = b * 3.5; }
    for (let i = 0; i < n; i++) d[i] = i < f ? x[i] * (i / f) + x[n + i] * (1 - i / f) : x[i];
  }
  function fillCrickets(d, c, sr) {                 // three field crickets, each with its own pitch, pace and place
    let s = 7;
    const R = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (const [f, period, pan, amp] of [[4300, 0.62, 0.22, 1], [4760, 0.83, 0.82, 0.7], [3940, 1.09, 0.5, 0.45]]) {
      const g = amp * (c ? pan : 1 - pan);
      for (let t0 = R() * period; t0 + 0.14 < d.length / sr; t0 += period * (0.92 + 0.16 * R())) {
        for (let p = 0; p < 3; p++) {               // a chirp is three quick strokes of the wing
          const a = Math.floor((t0 + p * 0.034) * sr), n = Math.floor(0.021 * sr);
          for (let i = 0; i < n; i++) d[a + i] += g * Math.sin(Math.PI * i / n) ** 2 * Math.sin(2 * Math.PI * f * i / sr);
        }
      }
    }
  }

  function init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC({ latencyHint: 'interactive' });
    out = gain(0);
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -9; limit.knee.value = 10; limit.ratio.value = 5; limit.attack.value = 0.004; limit.release.value = 0.2;
    chain(out, limit, ctx.destination);
    white = buffer(2, (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    brown = buffer(4, fillBrown);
    // the sizzle: a bright hiss that never holds still
    const am = gain(0.55), sizzle = gain(0), roar = gain(0);
    chain(loop(white, 0.83), filter('lowpass', 20), gain(13)).connect(am.gain);
    chain(loop(white), filter('highpass', 2600), filter('peaking', 6200, 0.8), am, sizzle, out);
    // the fire: a low breathing rumble under the crackle
    chain(loop(brown), filter('lowpass', 460), roar, out);
    // the night
    chain(loop(buffer(8, fillCrickets, 2)), gain(0.045), out);
    G = { sizzle, roar };
    out.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.6);
    return true;
  }

  // A burst of filtered noise with a sharp attack: crackles, spits, thumps and whooshes are all this.
  function burst({ src = white, type = 'bandpass', freq = 2000, to = 0, q = 1, peak = 0.2, attack = 0.002, decay = 0.03, when = 0 }) {
    if (!ctx || ctx.state !== 'running' || muted) return;
    const t = ctx.currentTime + when, len = attack + decay, s = ctx.createBufferSource(), f = filter(type, freq, q), g = gain(0);
    s.buffer = src;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    if (to) { f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(to, t + len * 0.6); }
    chain(s, f, g, out);
    s.start(t, Math.random() * Math.max(0, src.duration - len - 0.1));
    s.stop(t + len + 0.03);
  }
  const crackle = (n, spread, loud = 1) => {
    for (let i = 0; i < n; i++) burst({ freq: 900 + 3800 * Math.random() ** 2, q: 1.2 + 3 * Math.random(), peak: (0.04 + 0.2 * Math.random() ** 2) * loud, decay: 0.006 + 0.028 * Math.random(), when: Math.random() * spread });
  };

  // browsers only let sound start from inside a tap, click or key press
  function unlock() {
    if (!ctx && !init()) return;
    if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
  }
  for (const type of ['pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(type, unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (ctx) { if (document.hidden) ctx.suspend(); else ctx.resume(); } });

  const api = {
    get ctx() { return ctx; }, get out() { return out; }, get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('bbq-muted', muted ? '1' : '0'); } catch (_) { /* storage may be blocked */ }
      if (ctx) out.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.08);
      paint();
    },
    // fat catching light: a soft whoomph and a volley of crackles
    flare(s = 1) {
      burst({ src: brown, freq: 210, to: 760, q: 0.6, peak: 0.75 * Math.min(1.3, s), attack: 0.07, decay: 0.85 });
      crackle(5, 0.5, 0.8);
    },
    // something laid on the bars: the slap of meat on steel, then the hiss
    land(heat = 1) {
      burst({ src: brown, type: 'lowpass', freq: 300, peak: 0.55, attack: 0.004, decay: 0.08 });
      if (heat > 0.12) burst({ type: 'highpass', freq: 3000, peak: 0.3 * Math.min(1, heat), attack: 0.025, decay: 1.2 });
    },
    stoke() { crackle(10, 0.6, 1.1); },
    update() {
      if (!ctx || ctx.state !== 'running') return;
      const now = ctx.currentTime, p = Math.min(2, fire.power), s = food.sizzle;
      G.sizzle.gain.setTargetAtTime(0.02 * Math.min(1, s * 8) + 0.26 * s, now, 0.12);
      G.roar.gain.setTargetAtTime(0.06 + 0.11 * p, now, 0.1);
      if (now >= nextPop) { crackle(1, 0, 0.55 + 0.45 * p); nextPop = now - Math.log(1 - Math.random()) / (2.2 + 5 * p); }
      if (s > 0.02 && now >= nextSpit) {
        burst({ type: 'highpass', freq: 3500 + 4000 * Math.random(), peak: 0.04 + 0.12 * Math.random() * s, decay: 0.008 + 0.03 * Math.random() });
        nextSpit = now - Math.log(1 - Math.random()) / (1 + 11 * s);
      }
    },
  };
  if (btn) btn.addEventListener('click', () => api.toggle());
  paint();
  return api;
}

/**
 * Tiny playable variants for "feel" questions. The owner tries A and B blind
 * and keeps the one that felt right: what they do, not what they say.
 *
 * A demo mounts into an element and returns a function that stops it. Its
 * params come from the bank, one set per option, so a new question needs no
 * code as long as an existing demo can express the difference.
 *
 *   move  {inertia: 0..1}                    steering: instant, or with weight
 *   hit   {forgive: px, life: ms, every: ms}  tapping targets: hitbox, pace
 */

export const DEMOS = {
  move: {
    hint: 'Веди пальцем або мишею по полю, і точка піде слідом. Стрілки на клавіатурі теж працюють.',
    mount: mountMove,
  },
  hit: {
    hint: 'Торкайся кіл, поки вони не зникли.',
    mount: mountHit,
  },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function mountMove(host, params) {
  const f = field(host, 'Поле: веди точку пальцем, мишею чи стрілками');
  f.canvas.style.touchAction = 'none';
  const weight = clamp(Number(params.inertia) || 0, 0, 1);
  // a damped spring: with weight it gathers speed, overshoots a little and settles
  const stiffness = 0.03 - 0.022 * weight;
  const damping = 0.78 + 0.14 * weight;
  const pos = { x: f.dims.w / 2, y: f.dims.h / 2 };
  const vel = { x: 0, y: 0 };
  const target = { ...pos };
  const trail = [];
  let dragging = false;

  const aim = (p) => {
    target.x = clamp(p.x, 14, f.dims.w - 14);
    target.y = clamp(p.y, 14, f.dims.h - 14);
  };
  f.canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    f.canvas.setPointerCapture(e.pointerId);
    aim(f.local(e));
  });
  f.canvas.addEventListener('pointermove', (e) => {
    if (dragging || e.pointerType === 'mouse') aim(f.local(e));
  });
  f.canvas.addEventListener('pointerup', () => { dragging = false; });
  f.canvas.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] }[e.key];
    if (!step) return;
    e.preventDefault();
    aim({ x: target.x + step[0], y: target.y + step[1] });
  });

  f.run((g, c, dt) => {
    if (weight === 0) {
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.01) {
        const step = Math.min(dist, 9 * dt);
        pos.x += (dx / dist) * step;
        pos.y += (dy / dist) * step;
      }
    } else {
      const keep = damping ** dt;
      vel.x = (vel.x + (target.x - pos.x) * stiffness * dt) * keep;
      vel.y = (vel.y + (target.y - pos.y) * stiffness * dt) * keep;
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
    }
    trail.push({ x: pos.x, y: pos.y });
    if (trail.length > 28) trail.shift();

    g.strokeStyle = c.faint;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(target.x - 7, target.y);
    g.lineTo(target.x + 7, target.y);
    g.moveTo(target.x, target.y - 7);
    g.lineTo(target.x, target.y + 7);
    g.stroke();

    g.fillStyle = c.plot;
    trail.forEach((p, i) => {
      g.globalAlpha = (i / trail.length) * 0.35;
      g.beginPath();
      g.arc(p.x, p.y, 3, 0, Math.PI * 2);
      g.fill();
    });
    g.globalAlpha = 1;
    g.fillStyle = c.ink;
    g.beginPath();
    g.arc(pos.x, pos.y, 11, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = c.plot;
    g.beginPath();
    g.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
    g.fill();
  });
  return f.stop;
}

function mountHit(host, params) {
  const f = field(host, 'Поле з колами: торкайся їх, поки не зникли; пробіл влучає в найстаріше');
  f.canvas.style.touchAction = 'manipulation';
  const forgive = Number(params.forgive) || 0;
  const life = Number(params.life) || 1300;
  const every = Number(params.every) || 850;
  const R = 15;
  let targets = [];
  let pops = [];
  let next = performance.now() + 500;

  const radius = (t, now) => R * (1 - 0.35 * Math.min(1, (now - t.born) / life));
  const pop = (x, y, hit) => pops.push({ x, y, hit, at: performance.now() });

  f.canvas.addEventListener('pointerdown', (e) => {
    const p = f.local(e);
    const now = performance.now();
    let best = null;
    let bestDist = Infinity;
    for (const t of targets) {
      const d = Math.hypot(p.x - t.x, p.y - t.y);
      if (d < bestDist) {
        best = t;
        bestDist = d;
      }
    }
    if (best && bestDist <= radius(best, now) + forgive) {
      targets = targets.filter((t) => t !== best);
      pop(best.x, best.y, true);
    } else {
      pop(p.x, p.y, false);
    }
  });
  f.canvas.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    const t = targets.shift();
    if (t) pop(t.x, t.y, true);
  });

  f.run((g, c, dt, now) => {
    const { w, h } = f.dims;
    if (now >= next) {
      targets.push({ x: 24 + Math.random() * Math.max(1, w - 48), y: 24 + Math.random() * Math.max(1, h - 48), born: now });
      next = now + every * (0.75 + Math.random() * 0.5);
    }
    targets = targets.filter((t) => now - t.born < life);
    for (const t of targets) {
      g.beginPath();
      g.arc(t.x, t.y, radius(t, now), 0, Math.PI * 2);
      g.globalAlpha = 0.12;
      g.fillStyle = c.ink;
      g.fill();
      g.globalAlpha = 1;
      g.lineWidth = 2;
      g.strokeStyle = c.ink;
      g.stroke();
    }
    pops = pops.filter((p) => now - p.at < 450);
    for (const p of pops) {
      const k = (now - p.at) / 450;
      g.globalAlpha = 1 - k;
      g.beginPath();
      if (p.hit) {
        g.lineWidth = 2.5;
        g.strokeStyle = c.plot;
        g.arc(p.x, p.y, R + k * 14, 0, Math.PI * 2);
      } else {
        g.lineWidth = 2;
        g.strokeStyle = c.muted;
        g.moveTo(p.x - 6, p.y - 6);
        g.lineTo(p.x + 6, p.y + 6);
        g.moveTo(p.x + 6, p.y - 6);
        g.lineTo(p.x - 6, p.y + 6);
      }
      g.stroke();
      g.globalAlpha = 1;
    }
  });
  return f.stop;
}

/** A canvas that fills `host`, follows its width and the page's theme, and draws each frame. */
function field(host, label, height = 190) {
  const canvas = document.createElement('canvas');
  canvas.className = 'demo';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  host.replaceChildren(canvas);
  const g = canvas.getContext('2d');
  const dims = { w: host.clientWidth || 320, h: height };
  const fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dims.w = host.clientWidth || dims.w;
    canvas.width = Math.round(dims.w * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();
  const resize = new ResizeObserver(fit);
  resize.observe(host);

  const palette = () => {
    const css = getComputedStyle(host);
    const v = (name) => css.getPropertyValue(name).trim();
    return { ink: v('--ink'), plot: v('--plot'), faint: v('--faint'), muted: v('--muted') };
  };
  let colors = palette();
  let frame = 0;
  let raf = 0;
  let alive = true;

  return {
    canvas,
    dims,
    local(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    },
    run(draw) {
      let last = performance.now();
      const tick = (now) => {
        if (!alive) return;
        const dt = Math.min(50, now - last) / 16.667;
        last = now;
        frame += 1;
        if (frame % 30 === 0) colors = palette();
        g.clearRect(0, 0, dims.w, dims.h);
        draw(g, colors, dt, now);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    },
    stop() {
      alive = false;
      cancelAnimationFrame(raf);
      resize.disconnect();
    },
  };
}

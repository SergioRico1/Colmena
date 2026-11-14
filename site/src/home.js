(() => {
  const motion = document.documentElement.classList.contains("motion");

  // ── Capability demos: each plays once when it comes into view (motion only). ──
  const arrive = [...document.querySelectorAll(".demo, .rule-split, .import, .team-demo, .hub")];
  const countUp = (box) => {
    const nums = [...box.querySelectorAll("[data-count-to]")];
    const pct = box.querySelector("[data-pct]");
    const t0 = performance.now(), D = 2600;
    const fmt = (n) => n.toLocaleString("es-ES", { useGrouping: "always" });
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
      nums.forEach((el) => (el.textContent = fmt(Math.round(+el.dataset.countTo * e))));
      if (pct) pct.textContent = Math.round(100 * e) + " %";
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if (motion && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        io.unobserve(e.target);
        if (e.target.matches(".import")) countUp(e.target);
      }
    }, { rootMargin: "0px 0px -12% 0px" });
    arrive.forEach((el) => io.observe(el));

    // Sections rise into place as you reach them; siblings follow one another. Hidden only
    // once this observer exists (html.reveal-ready), so a page without JS shows everything.
    const rise = [...document.querySelectorAll("main > section:not(.hero) :is(.h2, .lead, .how-step, .cap-text, .demo, .team-demo, .feats, .tile, .vaults, .rule-split, .lm, .slack-copy, .import, .qs details, .lineup, #h-close, .close .wrap > p, .close .cta)")];
    const seen = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("seen");
        seen.unobserve(e.target);
      }
    }, { rootMargin: "0px 0px -8% 0px" });
    rise.forEach((el) => {
      const sib = [...el.parentElement.children].filter((c) => rise.includes(c));
      el.style.setProperty("--s", Math.min(5, sib.indexOf(el)));
      el.classList.add("rvl");
      seen.observe(el);
    });
    document.documentElement.classList.add("reveal-ready");
  } else arrive.forEach((el) => el.classList.add("in"));

  // ── The hive behind the hero: a honeycomb that breathes, and small pixel bots flying from
  // cell to cell, lighting the cells they land on in their person's colour. The demo's clock
  // speaks to it: when the mail waits, the cells by the window glow honey («te necesita»);
  // when it is sent, a green wave runs out. Reduced motion draws one still frame. ──
  {
    const hero = document.querySelector(".hero");
    const cv = document.createElement("canvas");
    const ctx = cv.getContext && cv.getContext("2d");
    if (hero && ctx) {
      cv.className = "hive";
      cv.setAttribute("aria-hidden", "true");
      hero.prepend(cv);
      hero.classList.add("has-hive");
      const R = 22, S3 = Math.sqrt(3), CW = S3 * R, RH = 1.5 * R;
      const COLORS = ["#B077C3", "#0A998D", "#5558EB", "#8B3BB6", "#268BBB", "#4786EA"];
      const HONEY = "255,201,60", GREEN = "60,196,138";
      const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
      let W = 0, H = 0, cols = 0, rows = 0, cells = [], bots = [], speed = 1, wide = false;
      const at = (c, r) => (c >= 0 && r >= 0 && c < cols && r < rows ? cells[r * cols + c] : null);
      const near = (cell) => {
        const { c, r } = cell, o = r & 1;
        return [at(c - 1, r), at(c + 1, r), at(c - 1 + o, r - 1), at(c + o, r - 1), at(c - 1 + o, r + 1), at(c + o, r + 1)].filter(Boolean);
      };
      // How strongly a spot shows: quiet behind the headline, fuller around the demo.
      const weight = (x, y) => wide ? Math.min(1, Math.max(0.18, (x / W - 0.2) / 0.45)) : Math.min(1, Math.max(0.18, (y / H - 0.3) / 0.35));
      let holes = [];
      const layout = () => {
        const hr = hero.getBoundingClientRect();
        holes = [".app", ".beats"].map((s) => document.querySelector(s)).filter(Boolean).map((el) => { const r = el.getBoundingClientRect(); return { l: r.left - hr.left - R, t: r.top - hr.top - R, r: r.right - hr.left + R, b: r.bottom - hr.top + R }; });
        const dpr = Math.min(1.5, devicePixelRatio || 1);
        W = hero.clientWidth; H = hero.clientHeight; wide = W >= 1100;
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cols = Math.ceil(W / CW) + 2; rows = Math.ceil(H / RH) + 2;
        cells = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const x = (c - 0.5) * CW + (r & 1 ? CW / 2 : 0), y = (r - 0.5) * RH;
          const hole = holes.some((h) => x > h.l && x < h.r && y > h.t && y < h.b);
          cells.push({ c, r, x, y, w: hole ? 0 : weight(x, y), ph: Math.random() * 6.283, glow: 0, rgb: "255,255,255", hold: 0, delay: 0 });
        }
        const pick = () => { for (let n = 0; n < 400; n++) { const k = cells[(Math.random() * cells.length) | 0]; if (k.w > 0.6 && k.x > 2 * R && k.x < W - 2 * R && k.y > 60 && k.y < H - 2 * R) return k; } return cells[(cells.length / 2) | 0]; };
        bots = COLORS.slice(0, wide ? 6 : 4).map((hex) => {
          const from = pick();
          return { rgb: rgb(hex), hex, from, to: from, t0: 0, dur: 1, wait: Math.random() * 1500 };
        });
      };
      const hexPath = (x, y, r) => {
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + (S3 / 2) * r, y - r / 2); ctx.lineTo(x + (S3 / 2) * r, y + r / 2);
        ctx.lineTo(x, y + r); ctx.lineTo(x - (S3 / 2) * r, y + r / 2); ctx.lineTo(x - (S3 / 2) * r, y - r / 2);
        ctx.closePath();
      };
      // A small pixel bot: its colour, two eyes, wings that beat.
      const drawBot = (x, y, hex, flap) => {
        const p = wide ? 4 : 3, X = Math.round(x - 2 * p), Y = Math.round(y - 2 * p);
        ctx.fillStyle = "rgba(241,241,244," + (flap ? 0.55 : 0.3) + ")";
        ctx.fillRect(X - p, Y + (flap ? 0 : p), p, p); ctx.fillRect(X + 4 * p, Y + (flap ? 0 : p), p, p);
        ctx.fillStyle = hex;
        ctx.fillRect(X, Y, 4 * p, 4 * p);
        ctx.fillStyle = "#F1F1F4";
        ctx.fillRect(X + p, Y + p, p, p); ctx.fillRect(X + 2 * p + 1, Y + p, p, p);
      };
      const draw = (now) => {
        ctx.clearRect(0, 0, W, H);
        const t = now / 1000;
        // The comb: line strength in a few steps, so it is a handful of paths a frame.
        const buckets = [[], [], [], [], []];
        for (const k of cells) {
          const a = k.w * (0.55 + 0.45 * Math.sin(t * 0.5 + k.ph + k.x * 0.004));
          buckets[Math.min(4, (a * 5) | 0)].push(k);
        }
        ctx.lineWidth = 1;
        buckets.forEach((list, i) => {
          if (!list.length) return;
          ctx.strokeStyle = `rgba(255,255,255,${0.035 + i * 0.022})`;
          ctx.beginPath();
          for (const k of list) hexPath(k.x, k.y, R - 1.5);
          ctx.stroke();
        });
        // Lit cells.
        for (const k of cells) {
          if (k.delay > now) continue;
          if (k.glow <= 0.01 || !k.w) continue;
          const g = k.glow * Math.max(0.35, k.w);
          ctx.beginPath(); hexPath(k.x, k.y, R - 3);
          ctx.fillStyle = `rgba(${k.rgb},${0.2 * g})`; ctx.fill();
          ctx.strokeStyle = `rgba(${k.rgb},${0.7 * g})`; ctx.stroke();
        }
        // The flying bots.
        for (const b of bots) {
          const k = Math.min(1, Math.max(0, (now - b.t0) / b.dur));
          const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          const x = b.from.x + (b.to.x - b.from.x) * e;
          const y = b.from.y + (b.to.y - b.from.y) * e - Math.sin(Math.PI * k) * 10;
          drawBot(x, y, b.hex, ((now / 110) | 0) % 2 === 0 && k < 1);
        }
      };
      const step = (now, dt) => {
        for (const k of cells) {
          if (k.delay > now) continue;
          if (k.hold > now) continue;
          k.glow = Math.max(0, k.glow - dt / 2600);
        }
        for (const b of bots) {
          if (now < b.t0 + b.dur + b.wait) continue;
          const land = b.to;
          if (b.from !== land) { land.glow = 1; land.rgb = b.rgb; land.delay = 0; }
          const options = near(land).filter((n) => n.w > 0.45 && n.y > 50 && n.y < H - 30 && n.x > 10 && n.x < W - 10);
          const next = options.length ? options[(Math.random() * options.length) | 0] : land;
          b.from = land; b.to = next; b.t0 = now; b.dur = 700 / speed; b.wait = (300 + Math.random() * 1400) / speed;
        }
      };
      // The demo's moments.
      const around = () => {
        const hr = hero.getBoundingClientRect(), r = (document.querySelector(".ask") || hero).getBoundingClientRect();
        return { x: r.left - hr.left + r.width * 0.5, y: r.top - hr.top + r.height * 0.5 };
      };
      addEventListener("colmena:hive", (ev) => {
        const now = performance.now();
        if (ev.detail === "work") speed = 1.8;
        if (ev.detail === "reset") speed = 1;
        if (ev.detail === "need") {
          speed = 1;
          const p = around();
          cells.forEach((k) => {
            const d = Math.hypot(k.x - p.x, k.y - p.y);
            if (k.w > 0 && d < 300 && Math.random() < 0.5) { k.rgb = HONEY; k.glow = 1; k.delay = now + d * 2; k.hold = now + 3200 + d * 2; }
          });
        }
        if (ev.detail === "sent") {
          const p = around();
          cells.forEach((k) => {
            const d = Math.hypot(k.x - p.x, k.y - p.y);
            if (k.w > 0 && d < 460 && Math.random() < 0.45) { k.rgb = GREEN; k.glow = 0.9; k.delay = now + d * 2.2; k.hold = 0; }
          });
        }
      });
      layout();
      let last = 0, raf = 0, shown = true, prev = 0;
      if (!motion) {
        // One still frame: a few lit cells, the bots resting on theirs.
        bots.forEach((b) => { b.to.glow = 1; b.to.rgb = b.rgb; });
        draw(0);
        addEventListener("resize", () => { layout(); bots.forEach((b) => { b.to.glow = 1; b.to.rgb = b.rgb; }); draw(0); });
      } else {
        // «Pausar» under the demo stills the hive too: one control for all the hero's motion.
        let held = false;
        addEventListener("colmena:hive", (ev) => { if (ev.detail === "pause") held = true; if (ev.detail === "play") { held = false; go(); } });
        const frame = (now) => {
          raf = 0;
          if (!shown || held || document.hidden) return;
          raf = requestAnimationFrame(frame);
          if (now - last < 32) return; // about 30 frames a second is plenty for a background
          step(now, Math.min(100, now - (prev || now)));
          prev = now; last = now;
          draw(now);
        };
        const go = () => { if (!raf && shown && !held && !document.hidden) { prev = 0; raf = requestAnimationFrame(frame); } };
        if ("IntersectionObserver" in window) new IntersectionObserver(([e]) => { shown = e.isIntersecting; go(); }).observe(hero);
        document.addEventListener("visibilitychange", go);
        let rt = 0;
        addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(layout, 150); });
        go();
      }
    }
  }

  // ── The hero: one encargo, on one clock. ──
  const app = document.querySelector("[data-demo]");
  if (!app) return;
  const feed = app.querySelector("[data-feed]");
  const K = [...app.querySelectorAll("[data-k]")];
  const ask = app.querySelector("[data-ask]");
  const sendBtn = app.querySelector("[data-send]");
  const need = app.querySelector("[data-need]");
  const count = app.querySelector("[data-count]");
  const typing = app.querySelector("[data-typing]");
  const typingWho = app.querySelector("[data-typing-who]");
  const cursor = app.querySelector("[data-cursor]");
  const main = app.querySelector(".app-main");
  const live = document.querySelector("[data-live]");
  const playBtn = document.querySelector("[data-play]");
  const playLabel = document.querySelector("[data-play-label]");
  const beats = [...document.querySelectorAll("[data-beat]")];
  const hive = (type) => dispatchEvent(new CustomEvent("colmena:hive", { detail: type }));
  const on = (el, yes = true) => el && el.toggleAttribute("data-on", yes);
  const SENT = 12300, END = 16200;
  let t = 0, next = 0, last = 0, playing = false, visible = true, raf = 0;

  // Keep the newest thing at the bottom of the channel, as a chat does (transform only: no
  // layout shift).
  const camera = (el) => {
    const pad = 6;
    const d = feed.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom - pad;
    feed.style.setProperty("--cam", Math.max(0, Math.round(d)) + "px");
  };
  const show = (i) => { const el = K[i]; el.inert = false; on(el); camera(el); };
  const run = (i) => { show(i); K[i].setAttribute("data-run", ""); };
  const done = (i) => K[i].removeAttribute("data-run");
  const working = (id, yes) => {
    on(app.querySelector(`[data-mood="${id}"]`), yes);
    const s = app.querySelector(`[data-state="${id}"]`);
    if (s) s.textContent = yes ? "trabajando" : "libre";
  };
  const say = (id) => {
    if (!id) return on(typing, false);
    typingWho.textContent = app.querySelector(`[data-mood="${id}"]`).dataset.name;
    on(typing);
  };
  const send = (byVisitor) => {
    if (ask.hasAttribute("data-sent")) return;
    ask.setAttribute("data-sent", "");
    hive("sent");
    on(count, false);
    need.setAttribute("data-done", "");
    on(cursor, false);
    cursor.removeAttribute("data-press");
    if (byVisitor) {
      live.textContent = "Correo enviado. Es un ejemplo: no ha salido ningún correo.";
      const s = ask.querySelector(".sent");
      s.tabIndex = -1;
      s.focus({ preventScroll: true });
    }
  };
  sendBtn.addEventListener("click", () => {
    send(true);
    if (playing) t = Math.max(t, SENT);
  });

  if (!motion) return; // Reduced motion: the finished conversation, with a working «Enviar».

  const reset = () => {
    K.forEach((el) => { el.removeAttribute("data-on"); el.removeAttribute("data-run"); el.inert = true; });
    ask.removeAttribute("data-sent");
    need.removeAttribute("data-done");
    on(count, false); on(cursor, false); say(null);
    working("nora", false); working("vera", false);
    feed.style.setProperty("--cam", "0px");
    app.classList.remove("fade");
  };
  const pointAtSend = () => {
    const m = main.getBoundingClientRect(), b = sendBtn.getBoundingClientRect();
    cursor.style.transition = "none";
    cursor.style.transform = `translate(${Math.round(m.width * 0.82)}px,${Math.round(m.height - 30)}px)`;
    on(cursor);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      cursor.style.transition = "";
      cursor.style.transform = `translate(${Math.round(b.left - m.left + b.width * 0.55)}px,${Math.round(b.top - m.top + b.height * 0.5)}px)`;
    }));
  };
  const T = [
    [0, () => { reset(); hive("reset"); }],
    [500, () => show(0)],
    [1700, () => show(1)],
    [2700, () => { working("nora", true); say("nora"); hive("work"); }],
    [3400, () => { say(null); show(2); run(3); }],
    [4100, () => { done(3); run(4); }],
    [4800, () => { done(4); run(5); }],
    [5500, () => done(5)],
    [5900, () => { show(6); working("nora", false); }],
    [6400, () => show(7)],
    [7200, () => { working("vera", true); say("vera"); }],
    [8200, () => { say(null); working("vera", false); show(8); show(9); }],
    [8900, () => { show(10); on(count); hive("need"); }],
    [11000, pointAtSend],
    [12000, () => cursor.setAttribute("data-press", "")],
    [SENT, () => send(false)],
    [15600, () => app.classList.add("fade")],
  ];
  const BEATS = [0, 2700, 5900, 8900, END];

  const frame = (now) => {
    raf = 0;
    if (!playing || !visible || document.hidden) return;
    t += Math.min(64, now - (last || now));
    last = now;
    if (t >= END) { t = 0; next = 0; }
    while (next < T.length && T[next][0] <= t) T[next++][1]();
    beats.forEach((li, i) => {
      const p = Math.max(0, Math.min(1, (t - BEATS[i]) / (BEATS[i + 1] - BEATS[i])));
      li.querySelector("i").style.setProperty("--p", p.toFixed(3));
      on(li, t >= BEATS[i] && t < BEATS[i + 1]);
    });
    raf = requestAnimationFrame(frame);
  };
  const wake = () => { if (!raf && playing && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } };

  playing = true;
  app.classList.add("playing");
  reset();
  wake();
  playBtn.addEventListener("click", () => {
    playing = !playing;
    playBtn.setAttribute("aria-pressed", String(!playing));
    playLabel.textContent = playing ? "Pausar" : "Reanudar";
    app.classList.toggle("paused", !playing);
    hive(playing ? "play" : "pause");
    wake();
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; wake(); }).observe(app);
  }
  document.addEventListener("visibilitychange", wake);
})();

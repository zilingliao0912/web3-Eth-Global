/* Dead Reckoning narrative layer — IntersectionObserver + churn_master.csv */
(function () {
  'use strict';

  const ETH_USD = 2000;

  function csvBool(v) {
    return String(v || '')
      .trim()
      .toLowerCase() === 'true';
  }
  function csvNum(v) {
    const n = parseFloat(String(v || '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  function isClean(r) {
    return !(
      csvBool(r.is_platform_operator) ||
      csvBool(r.is_bulk_mint) ||
      csvBool(r.is_nft_wrapped)
    );
  }
  function hasX402(r) {
    return String(r.x402_support || '')
      .trim()
      .toLowerCase() === 'true';
  }

  function dedupeOwnerEth(rows) {
    const m = {};
    rows.forEach((r) => {
      const o = r.owner_address;
      if (!o) return;
      if (m[o] == null) m[o] = csvNum(r.eth_in_successful_calls);
    });
    let s = 0;
    Object.keys(m).forEach((k) => {
      s += m[k];
    });
    return s;
  }

  function computeStats(rows) {
    const total = rows.length;
    const clean = rows.filter(isClean).length;
    const notAddr = rows.filter(
      (r) => csvBool(r.is_platform_operator) || csvBool(r.is_bulk_mint) || csvBool(r.is_nft_wrapped)
    ).length;
    const x402Clean = rows.filter((r) => isClean(r) && hasX402(r)).length;
    const x402TxClean = rows.filter((r) => isClean(r) && hasX402(r) && csvNum(r.total_txns) > 0).length;
    const activeNarrow = rows.filter(
      (r) => isClean(r) && hasX402(r) && csvNum(r.total_txns) > 0 && r.churn_type === 'active'
    ).length;
    const activeAll = rows.filter((r) => r.churn_type === 'active').length;
    const neverActivated = rows.filter((r) => r.churn_type === 'never_activated').length;
    const churned = rows.filter((r) => csvBool(r.is_churned)).length;
    const devrelGap = rows.filter((r) => isClean(r) && !hasX402(r)).length;
    const recoverAgents = rows.filter((r) => hasX402(r) && r.churn_type !== 'active').length;
    const dedupeEth = dedupeOwnerEth(rows);
    const baselineRealizedUsd = Math.round(dedupeEth * ETH_USD);
    const noisePct = total > 0 ? Math.round((notAddr / total) * 1000) / 10 : 0;
    const churnOrNeverPct = total > 0 ? Math.round(((total - activeAll) / total) * 1000) / 10 : 0;
    const abandoned = rows.filter((r) => r.churn_type === 'abandoned');
    const abEarly = abandoned.filter((r) => {
      const d = csvNum(r.days_to_churn);
      return d > 0 && d <= 3;
    }).length;
    const cliffPct =
      abandoned.length > 0 ? Math.round((abEarly / abandoned.length) * 1000) / 10 : 0;
    const everTx = rows.filter((r) => csvNum(r.total_txns) > 0).length;
    const activationPct =
      x402Clean > 0 ? Math.round((activeNarrow / x402Clean) * 1000) / 10 : 0;
    const avgDaysChurn = (function () {
      const arr = rows.map((r) => csvNum(r.days_to_churn)).filter((d) => d > 0);
      if (!arr.length) return 0;
      const sum = arr.reduce((a, b) => a + b, 0);
      return Math.round((sum / arr.length) * 10) / 10;
    })();
    return {
      total,
      clean,
      notAddr,
      x402Clean,
      x402TxClean,
      activeNarrow,
      activeAll,
      neverActivated,
      churned,
      devrelGap,
      recoverAgents,
      dedupeEth,
      baselineRealizedUsd,
      noisePct,
      churnOrNeverPct,
      cliffPct,
      everTx,
      activationPct,
      avgDaysChurn,
    };
  }

  function dropPct(cur, prev) {
    if (!prev) return null;
    return Math.round((cur / prev - 1) * 1000) / 10;
  }

  function buildFunnelStages(s) {
    const c0 = s.total;
    const c1 = s.clean;
    const c2 = s.x402Clean;
    const c3 = s.x402TxClean;
    const c4 = s.activeNarrow;
    const lost12 = 296 * (s.notAddr / 20015);
    const lost23 = 157 * (s.devrelGap / 10606);
    const gapNoTx = Math.max(s.x402Clean - s.x402TxClean, 1);
    const lost34 = 27.8 * (gapNoTx / 1754);
    const gapLast = Math.max(s.x402TxClean - s.activeNarrow, 0);
    const lost45 = 24.2 * (s.x402TxClean > 0 ? gapLast / s.x402TxClean : 0);
    return [
      {
        stage: 'Total registered',
        count: c0,
        drop: null,
        dropPct: null,
        usd: '$' + (511 * (c0 / 34563)).toFixed(0) + 'M theoretical',
        lost: null,
        lostNote: null,
        color: '#1E293B',
        particles: 0,
      },
      {
        stage: 'Clean real agents',
        subtext: 'remove platforms, bots, NFT wrappers',
        count: c1,
        drop: c1 - c0,
        dropPct: dropPct(c1, c0),
        usd: '$' + (215 * (c1 / 14548)).toFixed(1) + 'M',
        lost: '$' + lost12.toFixed(0) + 'M',
        lostNote: 'Registry pollution — structurally unreachable',
        color: '#0891B2',
        particles: 40,
      },
      {
        stage: 'Declared monetization',
        subtext: 'x402 configured in clean base',
        count: c2,
        drop: c2 - c1,
        dropPct: dropPct(c2, c1),
        usd: '$' + (58.3 * (c2 / 3942)).toFixed(1) + 'M',
        lost: '$' + lost23.toFixed(0) + 'M',
        lostNote: 'Real agents who never touched x402 — DevRel + awareness gap',
        color: '#EF9F27',
        particles: 32,
      },
      {
        stage: 'Ever transacted',
        subtext: 'x402 + at least 1 confirmed tx',
        count: c3,
        drop: c3 - c2,
        dropPct: dropPct(c3, c2),
        usd: '$' + (30.6 * (c3 / 2066)).toFixed(1) + 'M',
        lost: '$' + lost34.toFixed(1) + 'M',
        lostNote: 'Configured x402, never fired a transaction',
        color: '#EF9F27',
        particles: 18,
      },
      {
        stage: 'Currently active',
        count: c4,
        drop: c4 - c3,
        dropPct: dropPct(c4, c3),
        usd: '$' + (s.baselineRealizedUsd / 1e6).toFixed(2) + 'M actual',
        lost: '$' + lost45.toFixed(1) + 'M',
        lostNote: 'Fired at least once, then hit the day-one cliff',
        color: '#1D9E75',
        particles: 0,
        pulse: true,
      },
    ];
  }

  function buildMonthlyFromRows(rows) {
    const regBy = {};
    const ethBy = {};
    rows.forEach((r) => {
      const reg = (r.registered_at || '').slice(0, 7);
      if (reg.length === 7) regBy[reg] = (regBy[reg] || 0) + 1;
    });
    const owner = {};
    rows.forEach((r) => {
      const o = r.owner_address;
      if (!o) return;
      if (!owner[o]) {
        owner[o] = { eth: csvNum(r.eth_in_successful_calls), ft: r.first_txn_at || '' };
      }
    });
    Object.keys(owner).forEach((o) => {
      const ft = owner[o].ft;
      if (ft && ft.length >= 7) {
        const mo = ft.slice(0, 7);
        ethBy[mo] = (ethBy[mo] || 0) + owner[o].eth;
      }
    });
    const keys = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
    const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    let maxReg = 0;
    let maxRegKey = '2026-02';
    keys.forEach((k) => {
      const v = regBy[k] || 0;
      if (v > maxReg) {
        maxReg = v;
        maxRegKey = k;
      }
    });
    return keys.map((k, i) => {
      const eth = ethBy[k] || 0;
      const regc = regBy[k] || 0;
      let note = '';
      if (k === '2026-01') note = 'Protocol launched Jan 29';
      if (k === '2026-02') note = 'Launch wave — ' + regc.toLocaleString() + ' registrations';
      if (k === '2026-06') note = 'Partial month (live data)';
      return {
        month: labels[i],
        eth: Math.round(eth),
        usd: Math.round(eth * ETH_USD),
        note: note,
        highlight: k === maxRegKey,
      };
    });
  }

  function cohortEarlyForMonth(rows, ym) {
    const sub = rows.filter((r) => (r.registered_at || '').slice(0, 7) === ym);
    const n = sub.length;
    if (!n) return { churnedEarly: 0, survived: 0, churnRate: '0%', note: '' };
    let early = 0;
    sub.forEach((r) => {
      const dt = csvNum(r.days_to_churn);
      if (r.churn_type === 'never_activated') early += 1;
      else if (dt > 0 && dt <= 7) early += 1;
    });
    const survived = n - early;
    const rate = Math.round((early / n) * 100);
    return { churnedEarly: early, survived: survived, churnRate: rate + '%', note: '' };
  }

  function buildCohortFromRows(rows) {
    const specs = [
      { ym: '2026-02', label: 'Feb 2026', note: 'Launch wave — highest churn rate, protocol still unstable' },
      { ym: '2026-03', label: 'Mar 2026', note: 'Stabilization period' },
      { ym: '2026-04', label: 'Apr 2026', note: 'Survival rate crosses 50% for first time' },
      { ym: '2026-05', label: 'May 2026', note: 'Improving — later cohorts show better retention' },
    ];
    return specs.map((sp) => {
      const o = cohortEarlyForMonth(rows, sp.ym);
      o.month = sp.label;
      o.note = sp.note;
      return o;
    });
  }

  let funnelStages = [];
  let monthlyRevenue = [];
  let cohortData = [];

  let x402DeclaredAgents = 3942;
  let avgRealizedPerAgent = 14800;
  let baselineRealized = 6400000;

  function injectFromRows(rows) {
    const s = computeStats(rows);
    funnelStages = buildFunnelStages(s);
    monthlyRevenue = buildMonthlyFromRows(rows);
    cohortData = buildCohortFromRows(rows);
    x402DeclaredAgents = s.x402Clean;
    baselineRealized = s.baselineRealizedUsd;
    avgRealizedPerAgent = 14800;

    const fmtInt = function (n) {
      return Math.round(n).toLocaleString('en-US');
    };
    const fmtM = function (n) {
      return '$' + (n / 1e6).toFixed(1) + 'M';
    };
    const grossAt67 = Math.round(x402DeclaredAgents * 0.67) * avgRealizedPerAgent;
    const netAt67 = grossAt67 - baselineRealized;
    const subAddr = fmtM(27.8e6 * (s.x402Clean - s.x402TxClean) / 1754);
    const subCliff = fmtM(24.2e6 * ((s.x402TxClean - s.activeNarrow) / Math.max(s.x402TxClean - s.activeNarrow, 1)));
    const subTotal = fmtM(52e6 * (s.recoverAgents / 3509));
    const netR = fmtM(netAt67);
    const grossR = fmtM(grossAt67);
    const agents67 = Math.round(x402DeclaredAgents * 0.67);

    const setText = function (id, txt) {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };
    const sub = document.querySelector('#landing-hero .subtitle');
    if (sub) {
      sub.textContent =
        s.total.toLocaleString('en-US') +
        ' agents registered. ' +
        s.everTx.toLocaleString('en-US') +
        ' ever made money. Dead Reckoning diagnoses every failure in between — classified, quantified, and ready to act on.';
    }
    const h0 = document.querySelector('#hero-card-0 .hero-stat-val');
    if (h0) h0.textContent = s.churnOrNeverPct + '%';
    const h1 = document.querySelector('#hero-card-1 .hero-stat-val');
    if (h1) h1.textContent = fmtM(215e6 * (s.clean / 14548));
    const h2 = document.querySelector('#hero-card-2 .hero-stat-val');
    if (h2) h2.textContent = fmtM(32.7e6 * (s.recoverAgents / 3509));

    setText('kpi-entered', s.total.toLocaleString('en-US'));
    setText('kpi-churned', s.churned.toLocaleString('en-US'));
    setText(
      'kpi-churned-usd',
      '\u00d7$' +
        Math.round(baselineRealized / Math.max(s.churned, 1)).toLocaleString('en-US')
    );
    setText('kpi-active', s.activeAll.toLocaleString('en-US'));
    setText('kpi-confirmed', s.everTx.toLocaleString('en-US'));
    setText(
      'kpi-confirmed-usd',
      '\u00d7$' + Math.round(baselineRealized / Math.max(s.everTx, 1)).toLocaleString('en-US')
    );

    const kpiBar = document.getElementById('kpi-bar');
    if (kpiBar) {
      const spans = kpiBar.querySelectorAll('span');
      spans.forEach(function (sp) {
        if (sp.textContent && sp.textContent.indexOf('AVG DAYS TO CHURN') >= 0) {
          const v = sp.querySelector('.k-val');
          if (v) v.textContent = String(s.avgDaysChurn);
        }
        if (sp.textContent && sp.textContent.indexOf('PLATFORM NOISE') >= 0) {
          const v = sp.querySelector('.k-val');
          if (v) v.textContent = s.noisePct + '%';
        }
      });
    }

    const foot = document.querySelector('#funnel-foot .funnel-foot-pill');
    if (foot) {
      foot.textContent =
        fmtM(s.baselineRealizedUsd) +
        ' realized. ' +
        fmtM(215e6 * (s.clean / 14548)) +
        ' left on the table.';
    }

    function setBucketCard(cardId, amt, agentCount, subFront, subBack) {
      const card = document.getElementById(cardId);
      if (!card) return;
      const frontAmt = card.querySelector('.bucket-face.front .bucket-amt');
      const backAmt = card.querySelector('.bucket-face.back .bucket-amt');
      const backAgents = card.querySelector('.bucket-face.back span[style*="12px"]');
      if (frontAmt) frontAmt.textContent = amt;
      if (backAmt) backAmt.textContent = amt;
      if (backAgents) backAgents.textContent = agentCount.toLocaleString('en-US') + ' agents';
      if (subFront) {
        const sf = card.querySelector('.bucket-face.front .bucket-2-amt-sub');
        if (sf) sf.textContent = subFront;
      }
      if (subBack) {
        const sb = card.querySelector('.bucket-face.back .bucket-2-amt-sub');
        if (sb) sb.textContent = subBack;
      }
    }
    setBucketCard(
      'bucket-0',
      fmtM(296e6 * (s.notAddr / 20015)),
      s.notAddr,
      null,
      null
    );
    setBucketCard(
      'bucket-1',
      fmtM(157e6 * (s.devrelGap / 10606)),
      s.devrelGap,
      null,
      null
    );
    const fullPool = 52e6 * (s.recoverAgents / 3509);
    const netRec = 32.7e6 * (s.recoverAgents / 3509);
    const subLine = '\u2192 ' + fmtM(netRec) + ' net recovery at 67% activation';
    setBucketCard('bucket-2', fmtM(fullPool), s.recoverAgents, subLine, subLine);
    const b2desc = document.querySelector('#bucket-2 .bucket-face.back .bucket-desc');
    if (b2desc) {
      b2desc.textContent =
        'Full pool: ' +
        fmtM(fullPool) +
        ' \u00b7 Realistic recovery at 67% fix rate: ' +
        fmtM(netRec) +
        ' net (' +
        fmtM(grossAt67) +
        ' gross \u2212 ' +
        fmtM(s.baselineRealizedUsd) +
        ' baseline).';
    }

    const cap = document.getElementById('chart-caption');
    if (cap) {
      cap.textContent =
        'Total realized: ' +
        s.dedupeEth.toFixed(0) +
        ' ETH \u00b7 ' +
        fmtM(s.baselineRealizedUsd) +
        ' \u00b7 Potential from clean base: ' +
        fmtM(215e6 * (s.clean / 14548));
    }
    const co = document.getElementById('cohort-callout');
    if (co && cohortData.length >= 2) {
      co.textContent =
        cohortData[0].month +
        ' cohort: ' +
        cohortData[0].churnRate +
        ' early-churn rate. By ' +
        cohortData[cohortData.length - 1].month.split(' ')[0] +
        ': ' +
        cohortData[cohortData.length - 1].churnRate +
        '. Retention is improving \u2014 but the launch wave damage is already priced in.';
    }
    const cliffP = document.querySelector('#cliff-copy p');
    if (cliffP) {
      cliffP.textContent = s.cliffPct + '% of abandoned agents quit within 3 days.';
    }
    const rc = document.querySelector('#act-recovery .recovery-context');
    if (rc) {
      rc.textContent =
        s.x402Clean.toLocaleString('en-US') +
        ' agents configured x402. Only ' +
        s.activeNarrow.toLocaleString('en-US') +
        ' are active in that monetized pipeline today \u2014 a ' +
        s.activationPct +
        '% activation rate. If we fix that:';
    }
    const rsSub = document.getElementById('rs-agents-sub');
    if (rsSub) rsSub.textContent = 'vs. ' + s.activeNarrow.toLocaleString('en-US') + ' today';
    const rsUnlockSub = document.getElementById('rs-unlock-sub');
    if (rsUnlockSub) rsUnlockSub.textContent = 'above ' + fmtM(s.baselineRealizedUsd) + ' baseline';
    const rr = document.getElementById('recovery-receipt');
    if (rr) {
      const rowsR = rr.querySelectorAll('.rr-row');
      if (rowsR[0] && rowsR[0].children[1]) rowsR[0].children[1].textContent = subAddr;
      if (rowsR[1] && rowsR[1].children[1]) rowsR[1].children[1].textContent = subCliff;
      if (rowsR[2] && rowsR[2].children[1]) rowsR[2].children[1].textContent = subTotal;
      if (rowsR[3] && rowsR[3].children[1]) rowsR[3].children[1].textContent = '-' + fmtM(s.baselineRealizedUsd);
      if (rowsR[4] && rowsR[4].children[1]) rowsR[4].children[1].textContent = netR;
      if (rowsR[5] && rowsR[5].children[1]) rowsR[5].children[1].textContent = grossR;
      if (rowsR[6] && rowsR[6].children[1]) rowsR[6].children[1].textContent = agents67.toLocaleString('en-US');
    }
  }

  function calculate(fixRate) {
    const newActiveAgents = Math.round(x402DeclaredAgents * (fixRate / 100));
    const grossProtocolValue = newActiveAgents * avgRealizedPerAgent;
    const netValueUnlocked = grossProtocolValue - baselineRealized;
    return { newActiveAgents, grossProtocolValue, netValueUnlocked };
  }

  function fmtUsdCompact(n) {
    const m = n / 1e6;
    const sign = m < 0 ? '-' : '';
    return sign + '$' + Math.abs(m).toFixed(1) + 'M';
  }

  function onceInView(el, cb, opts) {
    if (!el) return;
    const o = Object.assign({ threshold: 0.12, rootMargin: '0px 0px -8% 0px' }, opts);
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          cb(e);
          io.disconnect();
        });
      },
      o
    );
    io.observe(el);
  }

  /* —— Opening particle rain —— */
  function runOpeningRain() {
    const wrap = document.getElementById('story-opening');
    const canvas = document.getElementById('opening-rain-canvas');
    if (!wrap || !canvas) return Promise.resolve();

    const ctx = canvas.getContext('2d');
    const N = 500;
    const survivors = 6;
    const survIdx = new Set();
    while (survIdx.size < survivors) survIdx.add((Math.random() * N) | 0);

    let w = 0;
    let h = 0;
    function resize() {
      const r = wrap.getBoundingClientRect();
      w = canvas.width = Math.max(320, Math.floor(r.width));
      h = canvas.height = Math.max(320, Math.floor(r.height));
    }
    resize();
    window.addEventListener('resize', resize);

    const dots = [];
    for (let i = 0; i < N; i++) {
      const survivor = survIdx.has(i);
      const deathFrac = survivor ? 1.1 : 0.2 + Math.random() * 0.7;
      dots.push({
        x: Math.random() * w,
        y: -20 - Math.random() * h * 0.4,
        vy: 0.55 + Math.random() * 1.15,
        vx: (Math.random() - 0.5) * 0.45,
        survivor,
        deathY: deathFrac * h,
        gray: false,
        alpha: 1,
        settled: false,
      });
    }

    let start = null;
    const HARD_MS = 4000;

    return new Promise((resolve) => {
      function frame(t) {
        if (!start) start = t;
        const elapsed = t - start;
        ctx.clearRect(0, 0, w, h);

        dots.forEach((d) => {
          if (d.settled) {
            if (d.survivor) {
              ctx.beginPath();
              ctx.fillStyle = 'rgba(29,158,117,' + d.alpha + ')';
              ctx.shadowColor = 'rgba(29,158,117,0.55)';
              ctx.shadowBlur = 8;
              ctx.arc(d.x, d.y, 3.2, 0, Math.PI * 2);
              ctx.fill();
              ctx.shadowBlur = 0;
            }
            return;
          }
          d.x += d.vx;
          d.y += d.vy;
          if (!d.survivor && d.y >= d.deathY) {
            d.gray = true;
            d.alpha = Math.max(0, d.alpha - 0.04);
            d.vy *= 0.92;
            if (d.alpha < 0.04) d.settled = true;
          } else if (d.survivor && d.y > h - 48) {
            d.y = h - 40 - Math.random() * 8;
            d.settled = true;
          }
          if (d.gray) {
            ctx.fillStyle = 'rgba(100,116,139,' + (d.alpha * 0.85) + ')';
          } else if (d.survivor) {
            ctx.fillStyle = 'rgba(29,158,117,' + d.alpha + ')';
            ctx.shadowColor = 'rgba(29,158,117,0.45)';
            ctx.shadowBlur = 6;
          } else {
            ctx.fillStyle = 'rgba(30,41,59,' + (0.25 + d.alpha * 0.35) + ')';
          }
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.survivor ? 3.2 : 2.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        });

        if (elapsed < HARD_MS) {
          requestAnimationFrame(frame);
        } else {
          setTimeout(() => {
            wrap.classList.add('is-done');
            window.removeEventListener('resize', resize);
            resolve();
          }, 500);
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function runHeroCardSequence() {
    const h1 = document.getElementById('hero-headline');
    const cards = [0, 1, 2].map((i) => document.getElementById('hero-card-' + i));
    const cue = document.getElementById('landing-scroll-cue');
    if (h1) {
      h1.classList.add('is-visible');
    }
    setTimeout(() => {
      if (cards[0]) {
        cards[0].classList.remove('narr-wait');
        cards[0].classList.add('narr-in');
      }
    }, 80);
    setTimeout(() => {
      if (cards[1]) {
        cards[1].classList.remove('narr-wait');
        cards[1].classList.add('narr-in');
      }
    }, 480);
    setTimeout(() => {
      if (cards[2]) {
        cards[2].classList.remove('narr-wait');
        cards[2].classList.add('narr-in');
      }
    }, 880);
    setTimeout(() => {
      if (cue) cue.classList.add('is-ready');
    }, 1280);
  }

  function buildFunnel() {
    const host = document.getElementById('funnel-rows');
    if (!host) return;
    const maxC = funnelStages[0].count;
    funnelStages.forEach((row, idx) => {
      const pct = maxC > 0 ? (row.count / maxC) * 100 : 0;
      const rowEl = document.createElement('div');
      rowEl.className = 'funnel-row';
      rowEl.dataset.pulse = row.pulse ? '1' : '0';
      const tip = row.lost ? row.lost + ' at this stage — ' + row.lostNote : '';
      rowEl.title = tip;
      const sub = row.subtext ? '<div class="funnel-sub">' + row.subtext + '</div>' : '';
      rowEl.innerHTML =
        '<div><div class="funnel-row-label">' +
        row.stage +
        '</div>' +
        sub +
        '</div>' +
        '<div class="funnel-bar-wrap"><div class="funnel-bar" data-w="' +
        pct +
        '" style="background:' +
        row.color +
        '"></div></div>' +
        '<div class="funnel-meta"><div class="funnel-count">' +
        row.count.toLocaleString() +
        '</div><div class="funnel-usd">' +
        row.usd +
        '</div></div>';
      host.appendChild(rowEl);
      if (idx > 0) {
        const d = funnelStages[idx];
        const prev = funnelStages[idx - 1];
        const dropEl = document.createElement('div');
        dropEl.className = 'funnel-drop';
        dropEl.textContent =
          '▼ ' +
          (d.drop < 0 ? d.drop.toLocaleString() : '') +
          ' (' +
          d.dropPct +
          '%)';
        dropEl.title = (d.lost || '') + ' — ' + (d.lostNote || '');
        host.appendChild(dropEl);
        rowEl._dropEl = dropEl;
      }
      rowEl._particles = row.particles;
      rowEl._color = row.color;
    });
  }

  function initFunnel() {
    const sec = document.getElementById('act-funnel');
    if (!sec) return;
    buildFunnel();
    const rows = Array.from(sec.querySelectorAll('.funnel-row'));
    let played = false;
    onceInView(sec, () => {
      if (played) return;
      played = true;
      const c0 = document.getElementById('hero-card-0');
      if (c0) c0.classList.add('is-cracked');
      rows.forEach((row, i) => {
        setTimeout(() => {
          row.classList.add('is-in');
          const bar = row.querySelector('.funnel-bar');
          if (bar) bar.style.width = bar.getAttribute('data-w') + '%';
          if (row._dropEl) row._dropEl.classList.add('is-in');
          const n = row._particles | 0;
          for (let k = 0; k < n; k++) {
            const dot = document.createElement('div');
            dot.className = 'funnel-escape-dot';
            dot.style.left = 12 + Math.random() * 80 + 'px';
            dot.style.top = 20 + Math.random() * 60 + '%';
            dot.style.background = row._color || '#64748B';
            row.appendChild(dot);
            requestAnimationFrame(() => {
              dot.style.transform = 'translate(140px, ' + (Math.random() * 40 - 20) + 'px)';
              dot.style.opacity = '0';
            });
          }
        }, i * 150);
      });
      setTimeout(() => {
        const foot = document.getElementById('funnel-foot');
        if (foot) foot.classList.add('is-in');
      }, rows.length * 150 + 400 + 200);
    });
  }

  function initBuckets() {
    const sec = document.getElementById('act-buckets');
    if (!sec) return;
    let started = false;
    onceInView(sec, () => {
      if (started) return;
      started = true;
      [0, 1, 2].forEach((i) => {
        setTimeout(() => {
          const card = document.getElementById('bucket-' + i);
          if (!card) return;
          card.classList.add('is-flipped');
          if (i === 0) {
            card.classList.add('bucket-card--punch');
            setTimeout(() => card.classList.remove('bucket-card--punch'), 220);
          }
          if (i === 1) {
            card.style.transitionDuration = '0.65s';
          }
          if (i === 2) {
            card.classList.add('bucket-card--glow');
            setTimeout(() => card.classList.remove('bucket-card--glow'), 620);
          }
        }, i * 400);
      });
    });
  }

  let chartsBuilt = false;
  function initCharts() {
    const sec = document.getElementById('act-rail-charts');
    if (!sec || typeof Chart === 'undefined') return;
    onceInView(sec, () => {
      if (chartsBuilt) return;
      chartsBuilt = true;
      const mEl = document.getElementById('chart-monthly');
      const cEl = document.getElementById('chart-cohort');
      if (mEl) {
        new Chart(mEl, {
          type: 'bar',
          data: {
            labels: monthlyRevenue.map((m) => m.month),
            datasets: [
              {
                label: 'ETH',
                data: monthlyRevenue.map((m) => m.eth),
                backgroundColor: monthlyRevenue.map((m) =>
                  m.highlight ? 'rgba(226,75,74,0.85)' : 'rgba(8,145,178,0.65)'
                ),
                borderWidth: 0,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  afterLabel(ctx) {
                    const row = monthlyRevenue[ctx.dataIndex];
                    return row.note || '';
                  },
                },
              },
            },
            scales: {
              y: { beginAtZero: true, grid: { color: 'rgba(13,27,42,0.08)' } },
              x: { grid: { display: false } },
            },
          },
        });
      }
      if (cEl) {
        new Chart(cEl, {
          type: 'bar',
          data: {
            labels: cohortData.map((c) => c.month),
            datasets: [
              {
                label: 'Churned within 7 days',
                data: cohortData.map((c) => c.churnedEarly),
                backgroundColor: 'rgba(226,75,74,0.75)',
                stack: 's',
              },
              {
                label: 'Survived 7+ days',
                data: cohortData.map((c) => c.survived),
                backgroundColor: 'rgba(8,145,178,0.65)',
                stack: 's',
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom' },
              tooltip: {
                callbacks: {
                  afterBody(items) {
                    const i = items[0].dataIndex;
                    return cohortData[i].note + ' · Churn ' + cohortData[i].churnRate;
                  },
                },
              },
            },
            scales: {
              x: { stacked: true, grid: { display: false } },
              y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(13,27,42,0.08)' } },
            },
          },
        });
      }
    });
  }

  function initCliff() {
    const sec = document.getElementById('act-cliff');
    const canvas = document.getElementById('cliff-canvas');
    const copy = document.getElementById('cliff-copy');
    if (!sec || !canvas) return;
    let ran = false;
    onceInView(sec, () => {
      if (ran) return;
      ran = true;
      const ctx = canvas.getContext('2d');

      function sizeCliffCanvas() {
        const ow = canvas.offsetWidth;
        const oh = canvas.offsetHeight;
        canvas.width = Math.max(320, ow || sec.clientWidth || window.innerWidth);
        canvas.height = Math.max(200, oh || 400);
      }

      sizeCliffCanvas();
      const onResize = () => {
        sizeCliffCanvas();
      };
      window.addEventListener('resize', onResize);

      let figs = [];
      function spawnFigs() {
        const w = canvas.width;
        const h = canvas.height;
        const edge = w * 0.7;
        const groundY = h * 0.75;
        figs = [];
        const n = 16;
        for (let i = 0; i < n; i++) {
          figs.push({
            x: -30 - i * (w * 0.035),
            groundY,
            vx: Math.max(1.2, w * 0.0018) * (0.9 + Math.random() * 0.4),
            dead: false,
            stop: Math.random() < 0.12,
            vy: 0,
            y: groundY,
            edge,
          });
        }
      }
      spawnFigs();

      let t0 = null;
      function step(ts) {
        if (!t0) t0 = ts;
        const elapsed = ts - t0;
        const w = canvas.width;
        const h = canvas.height;
        const edge = w * 0.7;
        const groundY = h * 0.75;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(13,27,42,0.08)';
        ctx.fillRect(edge, 0, w - edge, h);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(edge, h * 0.32);
        for (let x = edge; x < w; x += 8) {
          ctx.lineTo(x, h * 0.32 + Math.sin(x * 0.03) * 5);
        }
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        figs.forEach((f) => {
          if (!f.dead) {
            f.x += f.vx;
            f.groundY = groundY;
            if (f.x > edge - 10 && f.stop) {
              f.vx = 0;
            } else if (f.x > edge) {
              f.dead = true;
              f.y = groundY;
              f.vy = Math.max(2, h * 0.012);
            }
            ctx.font = '24px sans-serif';
            ctx.fillText('\u{1F6B6}', f.x, groundY);
          } else {
            f.y += f.vy;
            f.vy += Math.max(0.35, h * 0.0025);
            f.x += w * 0.0008;
            ctx.globalAlpha = Math.max(0, 0.85 - (f.y - groundY) / (h * 0.55));
            ctx.fillStyle = '#64748b';
            ctx.fillRect(f.x - 7, f.y - 12, 14, 20);
            ctx.globalAlpha = 1;
          }
        });

        if (copy && elapsed >= 4200) copy.classList.add('is-in');
        if (elapsed < 7200) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  function interpretLine(rate) {
    if (rate < 20) return 'Even modest onboarding improvements unlock tens of millions.';
    if (rate < 50) return 'A focused 48-hour activation campaign recovers most of the addressable gap.';
    if (rate <= 67) return 'Historically observed activation rate for genuine-user cohorts. Realistic ceiling without structural changes.';
    if (rate <= 74) return 'Upper bound of genuine-user activation. Requires infrastructure improvements beyond onboarding.';
    return 'Above this point, structural protocol changes are required, not just onboarding fixes.';
  }

  function initRecovery() {
    const sec = document.getElementById('act-recovery');
    const slider = document.getElementById('recovery-slider');
    const rsAgents = document.getElementById('rs-agents');
    const rsGross = document.getElementById('rs-gross');
    const rsUnlock = document.getElementById('rs-unlock');
    const rsGrossSub = document.getElementById('rs-gross-sub');
    const sliderLabel = document.getElementById('recovery-slider-label');
    const pctLabel = document.getElementById('recovery-slider-pct-label');
    const interp = document.getElementById('recovery-interpret');
    if (!sec || !slider) return;

    let displayed = { agents: 0, gross: 0, unlock: 0 };
    let target = { agents: 0, gross: 0, unlock: 0 };
    let raf = null;
    let live = false;

    function paintDom() {
      if (rsAgents) rsAgents.textContent = Math.round(displayed.agents).toLocaleString();
      if (rsGross) rsGross.textContent = fmtUsdCompact(displayed.gross);
      const unlock = Math.max(0, displayed.unlock);
      if (rsUnlock) rsUnlock.textContent = fmtUsdCompact(unlock);
      if (rsGrossSub) {
        const ga = Math.round(displayed.agents);
        const r = +slider.value;
        rsGrossSub.textContent =
          'at ' +
          r +
          '% activation · ' +
          ga.toLocaleString() +
          ' agents × $' +
          avgRealizedPerAgent.toLocaleString('en-US') +
          ' avg = ' +
          fmtUsdCompact(displayed.gross);
      }
    }

    function applyFromSlider() {
      const r = +slider.value;
      slider.setAttribute('aria-valuenow', String(r));
      const { newActiveAgents, grossProtocolValue, netValueUnlocked } = calculate(r);
      target = { agents: newActiveAgents, gross: grossProtocolValue, unlock: netValueUnlocked };
      if (interp) interp.textContent = interpretLine(r);
      if (sliderLabel) sliderLabel.textContent = 'Fix rate for x402-declared agents — ' + r + '%';
      if (pctLabel) {
        pctLabel.textContent = r + '%';
        pctLabel.style.left = r + '%';
      }
    }

    function tick() {
      const k = 0.22;
      let busy = false;
      ['agents', 'gross', 'unlock'].forEach((key) => {
        const cur = displayed[key];
        const tg = target[key];
        const n = cur + (tg - cur) * k;
        if (Math.abs(tg - n) < (key === 'agents' ? 0.51 : 12000)) displayed[key] = tg;
        else {
          displayed[key] = n;
          busy = true;
        }
      });
      paintDom();
      if (busy) raf = requestAnimationFrame(tick);
      else raf = null;
    }

    function kick() {
      applyFromSlider();
      if (!live) return;
      if (!raf) raf = requestAnimationFrame(tick);
    }

    slider.addEventListener('input', kick);
    slider.addEventListener('change', kick);

    onceInView(
      sec,
      () => {
        live = true;
        applyFromSlider();
        displayed = { agents: target.agents, gross: target.gross, unlock: Math.max(0, target.unlock) };
        target = { ...displayed };
        target = { ...displayed };
        paintDom();
        const receipt = document.getElementById('recovery-receipt');
        if (receipt) requestAnimationFrame(() => receipt.classList.add('is-visible'));
      },
      { threshold: 0.12, rootMargin: '0px 0px -5% 0px' }
    );
  }

  function boot() {
    runOpeningRain().then(runHeroCardSequence);
    initFunnel();
    initBuckets();
    initCharts();
    initCliff();
    initRecovery();
  }

  function startWithCsv(rows) {
    injectFromRows(rows || []);
    boot();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      var pr = window.__DR_CHURN_PROMISE__;
      if (pr && typeof pr.then === 'function') {
        pr.then(startWithCsv).catch(function () {
          injectFromRows([]);
          boot();
        });
      } else {
        injectFromRows([]);
        boot();
      }
    });
  } else {
    var pr2 = window.__DR_CHURN_PROMISE__;
    if (pr2 && typeof pr2.then === 'function') {
      pr2.then(startWithCsv).catch(function () {
        injectFromRows([]);
        boot();
      });
    } else {
      injectFromRows([]);
      boot();
    }
  }
})();

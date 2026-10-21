/* FAA-written-exam-style question generators for decoded reports.
   window.wxQuiz.makeQuestion(decoded, avoidIds) -> {id, stem, choices, answer, explain} | null */
(function () {
  'use strict';
  const D = window.wxDecode;
  const fmt = D.fmt, ordinal = D.ordinal, hhmm = D.hhmm, pad2 = D.pad2;

  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(arr) { return arr[rnd(arr.length)]; }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function dir3(d) { return String(d).padStart(3, '0'); }

  // Build a question: dedupe distractors against the answer and each other, cap at 4 choices.
  function q(id, stem, correct, distractors, explain) {
    const seen = new Set([correct.trim().toLowerCase()]);
    const ds = [];
    distractors.forEach(d => { if (!d) return; const k = d.trim().toLowerCase(); if (!seen.has(k)) { seen.add(k); ds.push(d); } });
    if (ds.length < 2) return null;
    const choices = shuffle([correct, ...ds.slice(0, 3)]);
    return { id, stem, choices, answer: choices.indexOf(correct), explain };
  }

  function windText(w) {
    if (!w) return null;
    if (w.calm) return 'Calm';
    let s = (w.dir === 'VRB' ? 'Variable direction' : 'From ' + dir3(w.dir) + '° true') + ' at ' + w.spd + ' knots';
    if (w.gst) s += ', gusting to ' + w.gst + ' knots';
    return s;
  }

  function visText(v) {
    if (!v) return null;
    const n = v.raw.replace('SM', '').replace(/^[MP]/, '');
    return (v.lessThan ? 'Less than ' : v.greaterThan ? 'Greater than ' : '') + n + ' statute mile' + (n === '1' && !v.lessThan ? '' : 's');
  }

  function ceilText(c) { return c == null ? 'No ceiling (no broken or overcast layer reported)' : fmt(c) + ' feet AGL'; }

  function mutateWx(raw) {
    const out = new Set();
    const inten = ['', '-', '+'];
    const m = /^(\+|-|VC)?(.*)$/.exec(raw);
    inten.forEach(i => { if (i !== (m[1] || '')) out.add(i + m[2]); });
    const swaps = [['RA', 'DZ'], ['RA', 'SN'], ['SN', 'SG'], ['SN', 'PL'], ['BR', 'FG'], ['FG', 'BR'], ['HZ', 'FU'], ['TS', 'SH'], ['SH', 'TS'], ['FZ', 'SH'], ['GR', 'GS'], ['PL', 'GS'], ['DZ', 'RA'], ['BR', 'HZ']];
    swaps.forEach(([a, b]) => { if (raw.includes(a)) out.add(raw.replace(a, b)); });
    if (!raw.startsWith('VC')) out.add('VC' + raw.replace(/^[+-]/, ''));
    out.delete(raw);
    return shuffle([...out]).map(c => D.decodeWx(c)).filter(Boolean).map(w => cap(w.text));
  }

  // ---------- METAR ----------
  const METAR = [
    function wind(d) {
      const w = d.f.wind; if (!w) return null;
      const correct = windText(w);
      let ds;
      if (w.calm) ds = ['From 000° at less than 1 knot', 'Wind data missing', 'Variable at 0 to 5 knots'];
      else if (w.dir === 'VRB') ds = ['From 000° true at ' + w.spd + ' knots', 'Variable direction at ' + w.spd + ' miles per hour', 'Calm, gusting to ' + w.spd + ' knots'];
      else ds = [
        'From ' + dir3(w.dir) + '° magnetic at ' + w.spd + ' knots' + (w.gst ? ', gusting to ' + w.gst + ' knots' : ''),
        'From ' + dir3(w.dir) + '° true at ' + w.spd + ' miles per hour' + (w.gst ? ', gusting to ' + w.gst : ''),
        w.gst ? 'From ' + dir3(w.dir) + '° true at ' + w.gst + ' knots, gusting to ' + w.spd + ' knots' : 'Toward ' + dir3(w.dir) + '° true at ' + w.spd + ' knots',
        'From ' + dir3((w.dir + 180) % 360) + '° true at ' + w.spd + ' knots'
      ];
      return q('metar-wind', 'What wind condition is reported?', correct, ds, 'Surface wind in a METAR is given as a three-digit direction in degrees TRUE, then speed in knots; G introduces gusts. ' + cap(w.text) + '.');
    },
    function windVar(d) {
      const w = d.f.wind; if (!w || w.varFrom == null) return null;
      const raw = dir3(w.varFrom) + 'V' + dir3(w.varTo);
      return q('metar-windvar', 'What does the group ' + raw + ' indicate?', 'Wind direction is varying between ' + w.varFrom + '° and ' + w.varTo + '°', ['Wind speed is varying between ' + w.varFrom / 10 + ' and ' + w.varTo / 10 + ' knots', 'Visibility varies between ' + w.varFrom + ' and ' + w.varTo + ' meters', 'A wind shift from ' + w.varFrom + '° to ' + w.varTo + '° occurred'], 'A dddVddd group after the wind means the direction varied by 60° or more with speed above 6 knots.');
    },
    function vis(d) {
      const v = d.f.vis; if (!v) return null;
      const n = v.raw.replace('SM', '').replace(/^[MP]/, '');
      return q('metar-vis', 'What is the reported prevailing visibility?', visText(v), [n + ' nautical miles', n + ' kilometers', (v.lessThan ? 'More than ' : v.greaterThan ? 'Less than ' : 'At least ') + n + ' statute miles', fmt(Math.round(v.sm * 1000)) + ' meters'], 'US METAR visibility is reported in statute miles (SM). M means less than, P means greater than. ' + cap(v.text) + '.');
    },
    function ceiling(d) {
      const sky = d.f.sky; if (!sky.length) return null;
      const c = d.f.ceiling;
      const correct = ceilText(c);
      const others = sky.filter(l => l.base != null && l.base !== c).map(l => fmt(l.base) + ' feet AGL');
      const ds = [...others];
      if (c != null) ds.push(fmt(c) + ' feet MSL', 'No ceiling (no broken or overcast layer reported)', fmt(c / 100) + ' feet AGL');
      else ds.push(sky[0].cover === 'CLR' ? '12,000 feet AGL' : 'Ceiling unknown', '1,200 feet AGL', 'Surface (sky obscured)');
      return q('metar-ceil', 'What is the ceiling?', correct, ds, 'The ceiling is the lowest BROKEN or OVERCAST layer (or vertical visibility into an obscuration), in feet above ground level. FEW and SCT layers are not a ceiling.');
    },
    function category(d) {
      if (!d.f.vis && !d.f.sky.length) return null;
      const cat = d.f.fltCat;
      const names = { VFR: 'VFR', MVFR: 'Marginal VFR (MVFR)', IFR: 'IFR', LIFR: 'Low IFR (LIFR)' };
      return q('metar-cat', 'Based on the ceiling and visibility, which flight category applies at this station?', names[cat], Object.keys(names).filter(k => k !== cat).map(k => names[k]), 'LIFR: ceiling below 500 ft or visibility below 1 SM. IFR: ceiling 500 to below 1,000 ft or visibility 1 to below 3 SM. MVFR: ceiling 1,000 to 3,000 ft or visibility 3 to 5 SM. VFR: ceiling above 3,000 ft and visibility above 5 SM. Here: ceiling ' + (d.f.ceiling == null ? 'none' : fmt(d.f.ceiling) + ' ft') + ', visibility ' + (d.f.vis ? d.f.vis.raw.replace('SM', '') + ' SM' : 'not reported') + '.');
    },
    function tempdew(d) {
      if (d.f.temp == null || d.f.dewp == null) return null;
      const t = d.f.temp, p = d.f.dewp;
      const correct = 'Temperature ' + t + '°C, dew point ' + p + '°C';
      const ds = ['Temperature ' + p + '°C, dew point ' + t + '°C', 'Temperature ' + t + '°F, dew point ' + p + '°F'];
      if (t < 0 || p < 0) ds.push('Temperature ' + Math.abs(t) + '°C, dew point ' + Math.abs(p) + '°C');
      else ds.push('Temperature ' + t + '°C, dew point -' + p + '°C');
      return q('metar-temp', 'What are the reported temperature and dew point?', correct, ds, 'The group is temperature/dew point in whole degrees Celsius; an M prefix means minus (below zero).');
    },
    function spread(d) {
      if (d.f.temp == null || d.f.dewp == null) return null;
      const s = d.f.spread;
      const alt = [s + 2, Math.max(0, s - 1), s + 5, Math.abs(d.f.temp + d.f.dewp)].filter(x => x !== s);
      return q('metar-spread', 'What is the temperature/dew point spread, and what does it suggest?', s + '°C' + (s <= 2 ? ': fog or low clouds are likely' : s <= 5 ? ': air is near saturation' : ': air is relatively dry'), alt.slice(0, 3).map(x => x + '°C' + (x <= 2 ? ': fog or low clouds are likely' : x <= 5 ? ': air is near saturation' : ': air is relatively dry')), 'Spread = temperature minus dew point. A spread of 2°C or less with light wind favors fog or low stratus.');
    },
    function altim(d) {
      const a = d.f.altimRaw; if (!a || a.inHg == null || a.hPa) return null;
      const v = a.inHg.toFixed(2);
      return q('metar-altim', 'What altimeter setting is reported?', v + ' inches of mercury', [v + ' millibars', (a.inHg * 10).toFixed(1) + ' hectopascals', '29.92 inches of mercury (standard)', (Number(v) - 1).toFixed(2) + ' inches of mercury'], 'A followed by four digits is the altimeter setting in inches of mercury with the decimal omitted: A' + v.replace('.', '') + ' = ' + v + ' inHg.');
    },
    function wx(d) {
      if (!d.f.wx.length) return null;
      const w = pick(d.f.wx);
      return q('metar-wx', 'What weather does ' + w.raw + ' indicate?', cap(w.text), mutateWx(w.raw), 'Weather groups are intensity (- light, + heavy, none = moderate, VC vicinity), descriptor (TS, SH, FZ, BL...), then phenomenon (RA, SN, BR, FG...).');
    },
    function time(d) {
      const t = d.f.time; if (!t) return null;
      const correct = 'On the ' + ordinal(t.day) + ' at ' + hhmm(t.hh, t.mm) + ' UTC';
      return q('metar-time', 'When was this observation taken?', correct, ['On the ' + ordinal(t.hh) + ' at ' + pad2(t.day) + ':' + pad2(t.mm) + 'Z', 'On the ' + ordinal(t.day) + ' at ' + hhmm(t.hh, t.mm).replace('Z', '') + ' local time', 'At ' + pad2(t.day) + ':' + pad2(t.hh) + ' UTC, ' + t.mm + ' minutes ago'], 'The date/time group is day-of-month, hour, minute, always UTC (Z): ' + t.raw + ' = ' + correct + '.');
    },
    function type(d) {
      if (d.f.type === 'SPECI') return q('metar-speci', 'What does SPECI at the start of the report signify?', 'A special observation issued because conditions changed significantly between routine reports', ['A routine hourly observation', 'A report from a station with special (non-standard) equipment', 'A forecast for the next 6 hours'], 'SPECI reports are issued off-schedule when visibility, ceiling, wind or weather crosses a set threshold.');
      return q('metar-type', 'What kind of report is a METAR?', 'A routine, usually hourly, observation of actual conditions at the station', ['A special observation issued when conditions change rapidly', 'A 24-hour forecast for the airport', 'A pilot report of conditions aloft'], 'METAR = aviation routine weather report. SPECI is the non-routine version.');
    },
    function auto(d) {
      if (!d.f.auto) return null;
      return q('metar-auto', 'What does AUTO in this report indicate?', 'The observation is fully automated with no human observer', ['The report was issued automatically on the hour', 'An automatic correction was applied', 'The station is unattended and the data may be unreliable'], 'AUTO means no human augmentation; AO1/AO2 in the remarks tells you the sensor type.');
    },
    function ao2(d) {
      const m = /\bAO([12])\b/.exec(d.f.remarksRaw); if (!m) return null;
      const correct = m[1] === '2' ? 'An automated station that has a precipitation discriminator (can tell rain from snow)' : 'An automated station without a precipitation discriminator';
      return q('metar-ao', 'What does AO' + m[1] + ' in the remarks mean?', correct, [m[1] === '2' ? 'An automated station without a precipitation discriminator' : 'An automated station that has a precipitation discriminator (can tell rain from snow)', 'The altimeter was observed twice', 'The observation was augmented by ' + m[1] + ' observers'], 'AO1 = no precipitation discriminator; AO2 = has one.');
    },
    function slp(d) {
      const m = /\bSLP(\d{3})\b/.exec(d.f.remarksRaw); if (!m) return null;
      const n = Number(m[1]); const hpa = ((n < 500 ? 1000 : 900) + n / 10).toFixed(1);
      return q('metar-slp', 'What does SLP' + m[1] + ' in the remarks indicate?', 'Sea level pressure ' + hpa + ' hPa', ['Sea level pressure ' + (n / 10).toFixed(1) + ' hPa', 'Sea level pressure ' + (n < 500 ? 900 + n / 10 : 1000 + n / 10).toFixed(1) + ' hPa', 'Sea level pressure ' + (n / 100).toFixed(2) + ' inHg'], 'SLP gives the last three digits of sea level pressure in hectopascals with tenths: prefix 10 (or 9 when the value is 500 or more).');
    },
    function tgroup(d) {
      const m = /\bT(\d)(\d{3})(\d)(\d{3})\b/.exec(d.f.remarksRaw); if (!m) return null;
      const t = (m[1] === '1' ? -1 : 1) * Number(m[2]) / 10, p = (m[3] === '1' ? -1 : 1) * Number(m[4]) / 10;
      const correct = 'Temperature ' + t.toFixed(1) + '°C and dew point ' + p.toFixed(1) + '°C';
      return q('metar-tgroup', 'What does the remark T' + m[1] + m[2] + m[3] + m[4] + ' report?', correct, ['Temperature ' + (Number(m[2]) / 100).toFixed(2) + '°C and dew point ' + (Number(m[4]) / 100).toFixed(2) + '°C', 'Temperature ' + t.toFixed(1) + '°C and dew point ' + (-p).toFixed(1) + '°C', 'A 24-hour temperature range of ' + t.toFixed(1) + '°C to ' + p.toFixed(1) + '°C'], 'The T group gives temperature and dew point to tenths of a degree: a leading 0 is positive, 1 is negative.');
    },
    function pkwnd(d) {
      const m = /PK WND (\d{3})(\d{2,3})\/(\d{2})?(\d{2})/.exec(d.f.remarksRaw); if (!m) return null;
      const when = m[3] ? hhmm(m[3], m[4]) : 'minute ' + m[4] + ' past the hour';
      return q('metar-pkwnd', 'What does PK WND ' + m[1] + m[2] + '/' + (m[3] || '') + m[4] + ' indicate?', 'Peak wind from ' + m[1] + '° at ' + Number(m[2]) + ' knots, which occurred at ' + when, ['Peak wind from ' + m[1] + '° at ' + Number(m[2]) + ' knots lasting ' + m[4] + ' minutes', 'Peak gust of ' + m[1] + ' knots from ' + m[2] + '°', 'Average wind ' + m[1] + '° at ' + Number(m[2]) + ' knots since ' + when], 'Peak wind remark: direction, speed, then the time (hhmm or mm) it occurred.');
    },
    function cover(d) {
      const layers = d.f.sky.filter(l => l.cover in D.COVER_SHORT); if (!layers.length) return null;
      const l = pick(layers);
      const eighths = { FEW: '1/8 to 2/8 of the sky', SCT: '3/8 to 4/8 of the sky', BKN: '5/8 to 7/8 of the sky', OVC: 'All (8/8) of the sky' };
      return q('metar-cover', 'In the group ' + l.raw + ', how much of the sky does the layer cover?', eighths[l.cover], Object.keys(eighths).filter(k => k !== l.cover).map(k => eighths[k]), 'FEW 1-2 oktas, SCT 3-4, BKN 5-7, OVC 8. Heights are in hundreds of feet AGL.');
    },
    function rvr(d) {
      if (!d.f.rvr.length) return null;
      const r = d.f.rvr[0];
      return q('metar-rvr', 'What does ' + r.raw + ' report?', cap(r.text), ['Runway ' + r.runway + ' is closed; visibility ' + fmt(r.ft) + ' meters', 'Runway ' + r.runway + ' visibility ' + fmt(r.ft) + ' feet, varying', 'The runway ' + r.runway + ' lighting is set to ' + fmt(r.ft) + ' ft'], 'Runway visual range: R, runway, slash, visual range in feet (M less than, P more than, V variable, U/D/N trend).');
    },
    function beginEnd(d) {
      const m = /\b([+-]?(?:TS|SH|FZ)?(?:RA|SN|DZ|PL|GR|TS|FG|BR))((?:[BE]\d{2,4})+)\b/.exec(d.f.remarksRaw); if (!m) return null;
      const w = D.decodeWx(m[1]); if (!w) return null;
      const line = d.lines.find(l => l.raw === m[0]); if (!line) return null;
      return q('metar-be', 'What does the remark ' + m[0] + ' indicate?', cap(line.text), [cap(w.text) + ' expected to begin at ' + m[2].slice(1), cap(w.text) + ' observed ' + m[2].replace(/[BE]/g, '') + ' minutes ago', 'Barometer ' + (m[2].startsWith('B') ? 'rose' : 'fell') + ' during ' + w.text], 'In remarks, B = began and E = ended, followed by the time (mm past the hour, or hhmm).');
    },
    function precip(d) {
      const m = /\bP(\d{4})\b/.exec(d.f.remarksRaw); if (!m) return null;
      const inches = (Number(m[1]) / 100).toFixed(2);
      return q('metar-precip', 'What does P' + m[1] + ' in the remarks indicate?', (Number(m[1]) === 0 ? 'A trace of precipitation (less than 0.01 inch)' : inches + ' inch of precipitation') + ' in the last hour', ['Pressure ' + (Number(m[1]) / 10).toFixed(1) + ' hPa', inches + ' inch of precipitation in the last 24 hours', 'Precipitation probability ' + Number(m[1]) + '%'], 'P plus four digits is hourly precipitation in hundredths of an inch.');
    }
  ];

  // ---------- TAF ----------
  const TAF = [
    function valid(d) {
      const v = d.f.valid; if (!v) return null;
      const correct = 'From ' + pad2(v.fromHr) + '00Z on the ' + ordinal(v.fromDay) + ' until ' + pad2(v.toHr) + '00Z on the ' + ordinal(v.toDay) + ' (' + v.hours + ' hours)';
      return q('taf-valid', 'What is the valid period of this TAF?', correct, ['From ' + pad2(v.fromDay) + pad2(v.fromHr) + 'Z to ' + pad2(v.toDay) + pad2(v.toHr) + 'Z on the day of issue', 'From ' + pad2(v.fromHr) + '00 on the ' + ordinal(v.fromDay) + ' until ' + pad2(v.toHr) + '00 on the ' + ordinal(v.toDay) + ', local time', 'From ' + pad2(v.fromHr) + '00Z on the ' + ordinal(v.fromDay) + ' until ' + pad2(v.toHr) + '00Z on the ' + ordinal(v.toDay + 1) + ' (' + (v.hours + 24) + ' hours)'], 'The valid group is DDHH/DDHH: start day and hour, then end day and hour, UTC. Most US TAFs run 24 hours; major hubs issue 30-hour TAFs.');
    },
    function hours(d) {
      const v = d.f.valid; if (!v) return null;
      return q('taf-hours', 'For how many hours is this forecast valid?', v.hours + ' hours', [v.hours === 24 ? '30 hours' : '24 hours', '12 hours', '6 hours'], 'Subtract the start from the end of the DDHH/DDHH group: ' + v.hours + ' hours.');
    },
    function issued(d) {
      const t = d.f.issue; if (!t) return null;
      return q('taf-issue', 'When was this TAF issued?', 'On the ' + ordinal(t.day) + ' at ' + hhmm(t.hh, t.mm) + ' UTC', ['On the ' + ordinal(t.hh) + ' at ' + pad2(t.day) + ':' + pad2(t.mm) + 'Z', 'At the start of the valid period', 'On the ' + ordinal(t.day) + ' at ' + hhmm(t.hh, t.mm).replace('Z', '') + ' local time'], 'The first time group (DDHHMMZ) is the issuance time. The following DDHH/DDHH group is the valid period.');
    },
    function fm(d) {
      const g = pick(d.f.groups.filter(x => x.kind === 'FM')); if (!g) return null;
      const t = g.from;
      return q('taf-fm', 'What does ' + g.hdr + ' indicate?', 'A rapid, permanent change in conditions beginning at ' + hhmm(t.hr, t.min) + ' on the ' + ordinal(t.day), ['A temporary fluctuation lasting less than an hour starting at ' + hhmm(t.hr, t.min), 'A gradual change between ' + pad2(t.day) + ':' + pad2(t.hr) + ' and ' + pad2(t.hr) + ':' + pad2(t.min), 'Conditions from ' + pad2(t.min) + '00Z on the ' + ordinal(t.hr)], 'FM (from) groups give DDHHMM. Everything after FM replaces the prior forecast until the next change group.');
    },
    function tempo(d) {
      const g = d.f.groups.find(x => x.kind === 'TEMPO'); if (!g || !g.from) return null;
      return q('taf-tempo', 'What does ' + g.hdr + ' indicate?', 'Temporary fluctuations between ' + pad2(g.from.hr) + '00Z on the ' + ordinal(g.from.day) + ' and ' + pad2(g.to.hr) + '00Z on the ' + ordinal(g.to.day) + ', each lasting less than an hour', ['A permanent change at ' + pad2(g.from.hr) + '00Z on the ' + ordinal(g.from.day), 'A gradual change completed by ' + pad2(g.to.hr) + '00Z on the ' + ordinal(g.to.day), 'Conditions valid continuously from ' + pad2(g.from.hr) + '00Z to ' + pad2(g.to.hr) + '00Z'], 'TEMPO conditions occur for less than an hour at a time and less than half of the period in total; the prevailing forecast still applies between fluctuations.');
    },
    function becmg(d) {
      const g = d.f.groups.find(x => x.kind === 'BECMG'); if (!g || !g.from) return null;
      return q('taf-becmg', 'What does ' + g.hdr + ' indicate?', 'A gradual change in conditions occurring between ' + pad2(g.from.hr) + '00Z on the ' + ordinal(g.from.day) + ' and ' + pad2(g.to.hr) + '00Z on the ' + ordinal(g.to.day), ['Temporary conditions between ' + pad2(g.from.hr) + '00Z and ' + pad2(g.to.hr) + '00Z', 'A rapid change at exactly ' + pad2(g.from.hr) + '00Z on the ' + ordinal(g.from.day), 'A ' + (g.to.hr - g.from.hr) + '0% chance of the conditions that follow'], 'BECMG shows a gradual change over the period given; the new conditions are expected to prevail after the period ends.');
    },
    function prob(d) {
      const g = d.f.groups.find(x => x.kind === 'PROB'); if (!g || !g.from) return null;
      return q('taf-prob', 'What does ' + g.hdr + ' indicate?', 'A ' + g.prob + '% probability of the conditions that follow between ' + pad2(g.from.hr) + '00Z on the ' + ordinal(g.from.day) + ' and ' + pad2(g.to.hr) + '00Z on the ' + ordinal(g.to.day), ['The conditions that follow will persist for ' + g.prob + ' minutes', 'A ' + (100 - g.prob) + '% probability of the conditions that follow', 'A ' + g.prob + '% probability, valid for the entire forecast period'], 'PROB30 or PROB40 gives the percent probability of thunderstorms or other precipitation events during the stated period.');
    },
    function prevailing(d) {
      const fms = d.f.groups.filter(x => x.kind === 'FM' || x.kind === 'BASE');
      if (fms.length < 2) return null;
      const g = pick(fms.filter(x => x.from));
      if (!g || !g.from) return null;
      // a time one hour into this group
      let hr = g.from.hr + 1, day = g.from.day; if (hr >= 24) { hr -= 24; day++; }
      const st = D.tafPrevailingAt(d.f, day, hr, 0);
      if (!st) return null;
      const which = pick(['wind', 'vis', 'sky'].filter(k => k === 'wind' ? st.wind : k === 'vis' ? st.vis : st.sky.length));
      if (!which) return null;
      const when = pad2(hr) + '00Z on the ' + ordinal(day);
      const alt = fms.filter(x => x !== g);
      if (which === 'wind') {
        return q('taf-at-wind', 'What wind is forecast for ' + when + '?', windText(st.wind), alt.map(x => windText(x.wind)).concat(['Calm']), 'Find the last FM (or base) group that starts at or before ' + when + '. TEMPO and PROB groups do not change the prevailing forecast. ' + cap(st.wind.text) + '.');
      }
      if (which === 'vis') {
        return q('taf-at-vis', 'What visibility is forecast for ' + when + '?', visText(st.vis), alt.map(x => visText(x.vis)).concat(['3 statute miles', '1 statute mile']), 'Find the last FM (or base) group in effect at ' + when + '. ' + cap(st.vis.text) + '.');
      }
      const c = st.ceiling;
      return q('taf-at-ceil', 'What ceiling is forecast for ' + when + '?', ceilText(c), alt.map(x => ceilText(x.ceiling)).concat(st.sky.filter(l => l.base != null && l.base !== c).map(l => fmt(l.base) + ' feet AGL')), 'Use the group in effect at ' + when + '; the ceiling is the lowest BKN or OVC layer. Sky: ' + st.sky.map(l => l.raw).join(' ') + '.');
    },
    function p6sm(d) {
      const g = d.f.groups.find(x => x.vis && x.vis.greaterThan); if (!g) return null;
      return q('taf-p6sm', 'What does P6SM mean?', 'Visibility greater than 6 statute miles', ['Visibility of exactly 6 statute miles', 'Visibility 6 statute miles with precipitation', 'Visibility less than 6 statute miles'], 'P = plus (greater than). TAFs do not forecast visibilities above 6 SM, so P6SM is the best visibility forecast.');
    },
    function ws(d) {
      const g = d.f.groups.find(x => x.ws); if (!g) return null;
      const w = g.ws;
      return q('taf-ws', 'What does WS' + pad2(w.hgt / 100).padStart(3, '0') + '/' + dir3(w.dir) + pad2(w.spd) + 'KT indicate?', 'Low-level wind shear: wind of ' + dir3(w.dir) + '° at ' + w.spd + ' knots at ' + fmt(w.hgt) + ' ft AGL', ['Surface wind ' + dir3(w.dir) + '° at ' + w.spd + ' knots with a ' + fmt(w.hgt) + ' ft inversion', 'Wind shear of ' + w.spd + ' knots per ' + fmt(w.hgt) + ' ft', 'Wind from ' + dir3(w.dir) + '° gusting to ' + w.spd + ' knots up to ' + fmt(w.hgt) + ' ft MSL'], 'WS groups forecast non-convective low-level wind shear: height in hundreds of feet AGL, then the wind at that height.');
    },
    function wx(d) {
      const all = []; d.f.groups.forEach(g => g.wx.forEach(w => all.push(w)));
      if (!all.length) return null;
      const w = pick(all);
      return q('taf-wx', 'What weather does ' + w.raw + ' forecast?', cap(w.text), mutateWx(w.raw), 'TAF weather groups use the same codes as METAR: intensity, descriptor, phenomenon.');
    },
    function nsw(d) {
      if (!d.f.groups.some(g => g.nsw)) return null;
      return q('taf-nsw', 'What does NSW indicate in a change group?', 'No significant weather: previously forecast weather is expected to end', ['Northwest surface wind', 'No sky condition warning', 'New SPECI warning'], 'NSW appears only in BECMG or TEMPO groups to show that weather phenomena are ending.');
    },
    function amd(d) {
      if (!d.f.amd) return null;
      return q('taf-amd', 'What does AMD after TAF indicate?', 'An amended forecast that replaces the previously issued TAF', ['An automated forecast', 'A forecast issued for a military field', 'A forecast valid for the AM hours only'], 'TAF AMD is issued when the current TAF no longer represents expected conditions. COR marks a corrected TAF.');
    }
  ];

  // ---------- PIREP ----------
  const TYPES = ['C172', 'PA28', 'SR22', 'BE36', 'C208', 'PC12', 'B738', 'A320', 'E75L', 'CRJ9', 'BE20', 'C56X', 'B752', 'DH8D'];
  const PIREP = [
    function kind(d) {
      return d.f.urgent
        ? q('pirep-uua', 'What does UUA indicate in this report?', 'An urgent pilot report (for example severe turbulence or icing, or low-level wind shear)', ['A routine pilot report', 'An unverified pilot report', 'An upper-air sounding'], 'UUA = urgent PIREP; UA = routine. Urgent reports cover severe or extreme turbulence, severe icing, hail, volcanic ash, LLWS and similar hazards.')
        : q('pirep-ua', 'What does UA indicate in this report?', 'A routine pilot weather report', ['An urgent pilot report', 'An upper-air observation', 'An unverified aircraft report'], 'UA = routine PIREP; UUA = urgent.');
    },
    function location(d) {
      const ov = d.f.ov; if (!ov) return null;
      const m = /^([A-Z]{3,4})(\d{3})(\d{3})$/.exec(ov.raw.trim());
      if (m) {
        return q('pirep-ov', 'Where was this report made?', Number(m[3]) + ' NM out on the ' + m[2] + '° radial from ' + m[1], [Number(m[2]) + ' NM out on the ' + m[3] + '° radial from ' + m[1], m[2] + ' NM from ' + m[1] + ' at ' + fmt(Number(m[3]) * 100) + ' ft', 'Over ' + m[1] + ' at ' + m[2] + m[3] + 'Z'], '/OV gives the location: a navaid or airport identifier, optionally followed by a 3-digit radial and a 3-digit distance in nautical miles.');
      }
      if (/^[A-Z]{3,4}$/.test(ov.raw.trim())) {
        return q('pirep-ov2', 'What does /OV ' + ov.raw.trim() + ' indicate?', 'The report was made over the ' + ov.raw.trim() + ' navaid or airport', ['The report originated from ' + ov.raw.trim() + ' Center', 'The aircraft is bound for ' + ov.raw.trim(), 'Overcast at the ' + ov.raw.trim() + ' station'], '/OV is the location of the report, given as a navaid or airport identifier (with optional radial and distance).');
      }
      return null;
    },
    function altitude(d) {
      if (d.f.fl == null) return null;
      const ft = d.f.fl;
      return q('pirep-fl', 'At what altitude was this report made?', fmt(ft) + ' feet MSL', [fmt(ft) + ' feet AGL', fmt(ft / 100) + ' feet MSL', fmt(ft * 10) + ' feet MSL'], '/FL gives altitude or flight level in hundreds of feet MSL: ' + pad2(ft / 100).padStart(3, '0') + ' = ' + fmt(ft) + ' ft.');
    },
    function type(d) {
      if (!d.f.tp || d.f.tp === 'UNKN') return null;
      return q('pirep-tp', 'What type of aircraft made this report?', d.f.tp, shuffle(TYPES.filter(t => t !== d.f.tp)).slice(0, 3), '/TP is the aircraft type (ICAO designator). It matters: light turbulence to a B738 may be severe to a C172.');
    },
    function turb(d) {
      const tb = d.f.tb; if (!tb) return null;
      const sev = /^(NEG|LGT-MOD|MOD-SEV|LGT|MOD|SEV|EXTRM|SMOOTH)/.exec(tb.raw.trim());
      if (!sev) return null;
      const words = { NEG: 'No turbulence', LGT: 'Light turbulence', 'LGT-MOD': 'Light to moderate turbulence', MOD: 'Moderate turbulence', 'MOD-SEV': 'Moderate to severe turbulence', SEV: 'Severe turbulence', EXTRM: 'Extreme turbulence', SMOOTH: 'Smooth air' };
      const rest = tb.text.replace(/^[^,]*?(turbulence|negative: no turbulence encountered|smooth)/, '').trim();
      const suffix = rest ? ' ' + rest : '';
      return q('pirep-tb', 'What turbulence was reported?', words[sev[1]] + suffix, Object.keys(words).filter(k => k !== sev[1]).map(k => words[k] + suffix).slice(0, 5), '/TB reports turbulence intensity (NEG, LGT, MOD, SEV, EXTRM), type (CHOP, CAT), frequency (OCNL, INTMT, CONS) and altitude range. ' + cap(tb.text) + '.');
    },
    function icing(d) {
      const ic = d.f.ic; if (!ic) return null;
      const sev = /^(NEG|TRACE|TRC|LGT|MOD|SEV)/.exec(ic.raw.trim());
      if (!sev) return null;
      const typ = /RIME/.test(ic.raw) ? ' rime' : /CLR/.test(ic.raw) ? ' clear' : /MX/.test(ic.raw) ? ' mixed' : '';
      const words = { NEG: 'No icing', TRACE: 'Trace' + typ + ' icing', LGT: 'Light' + typ + ' icing', MOD: 'Moderate' + typ + ' icing', SEV: 'Severe' + typ + ' icing' };
      const k = sev[1] === 'TRC' ? 'TRACE' : sev[1];
      return q('pirep-ic', 'What icing was reported?', words[k], Object.keys(words).filter(x => x !== k).map(x => words[x]), '/IC reports icing intensity (TRACE, LGT, MOD, SEV) and type (RIME, CLR, MX). ' + cap(ic.text) + '.');
    },
    function temp(d) {
      if (d.f.ta == null) return null;
      const t = d.f.ta;
      return q('pirep-ta', 'What outside air temperature was reported?', t + '°C', [(-t) + '°C', t + '°F', (t * 10) + '°C'].filter(x => x !== t + '°C'), '/TA is temperature in degrees Celsius; M means minus.');
    },
    function wind(d) {
      const w = d.f.wv; if (!w) return null;
      return q('pirep-wv', 'What wind aloft was reported?', 'From ' + dir3(w.dir) + '° at ' + w.spd + ' knots', ['From ' + dir3(w.spd) + '° at ' + w.dir + ' knots', 'From ' + dir3(w.dir) + '° at ' + w.spd + ' miles per hour', 'Toward ' + dir3(w.dir) + '° at ' + w.spd + ' knots'], '/WV is wind direction (degrees true) and speed in knots, written as dddff or ddd/ffKT.');
    },
    function sky(d) {
      const sk = d.f.sk; if (!sk) return null;
      const m = /^(FEW|SCT|BKN|OVC)(\d{3})?(?:-?TOPS?\s?(\d{3}))?/.exec(sk.raw.trim());
      if (!m || (!m[2] && !m[3])) return null;
      const cov = D.COVER_SHORT[m[1]];
      const parts = [];
      if (m[2]) parts.push('bases ' + fmt(Number(m[2]) * 100) + ' ft');
      if (m[3]) parts.push('tops ' + fmt(Number(m[3]) * 100) + ' ft');
      const correct = cap(cov) + ' layer, ' + parts.join(', ');
      const ds = [];
      if (m[2] && m[3]) ds.push(cap(cov) + ' layer, bases ' + fmt(Number(m[3]) * 100) + ' ft, tops ' + fmt(Number(m[2]) * 100) + ' ft');
      if (m[2]) ds.push(cap(cov) + ' layer, tops ' + fmt(Number(m[2]) * 100) + ' ft');
      if (m[3]) ds.push(cap(cov) + ' layer, bases ' + fmt(Number(m[3]) * 100) + ' ft');
      ds.push(cap(cov === 'overcast' ? 'broken' : 'overcast') + ' layer, ' + parts.join(', '));
      return q('pirep-sk', 'What sky condition was reported?', correct, ds, '/SK gives cloud cover with bases and, after TOP, the tops, in hundreds of feet MSL. ' + cap(sk.text) + '.');
    },
    function time(d) {
      const t = d.f.tm; if (!t) return null;
      return q('pirep-tm', 'When was this report made?', hhmm(t.hh, t.mm) + ' UTC', [hhmm(t.hh, t.mm).replace('Z', '') + ' local time', pad2(t.mm) + ':' + pad2(t.hh) + 'Z', 'On the ' + ordinal(t.hh) + ' at ' + pad2(t.mm) + '00Z'], '/TM is the time of the report in UTC (hhmm).');
    },
    function fv(d) {
      const wx = d.f.wx; if (!wx) return null;
      const m = /FV\s?(\d+)SM?/.exec(wx.raw); if (!m) return null;
      return q('pirep-fv', 'What does FV' + m[1] + 'SM indicate?', 'Flight visibility ' + Number(m[1]) + ' statute miles', ['Forecast visibility ' + Number(m[1]) + ' statute miles', 'Flight level ' + m[1] + '0 with smoke', 'Surface visibility ' + Number(m[1]) + ' statute miles'], 'In /WX, FV is flight visibility (what the pilot sees from the cockpit) in statute miles.');
    }
  ];

  const GENERATORS = { METAR: METAR, TAF: TAF, PIREP: PIREP };

  function makeQuestion(decoded, avoidIds) {
    const gens = shuffle(GENERATORS[decoded.type] || []);
    avoidIds = avoidIds || [];
    let fallback = null;
    for (const g of gens) {
      let out = null;
      try { out = g(decoded); } catch (e) { out = null; }
      if (!out) continue;
      if (avoidIds.includes(out.id)) { fallback = fallback || out; continue; }
      return out;
    }
    return fallback;
  }

  window.wxQuiz = { makeQuestion, shuffle };
})();

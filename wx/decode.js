/* Weather report decoders: METAR/SPECI, TAF, PIREP -> plain English.
   Exposes window.wxDecode = { detect, metar, taf, pirep }.
   Each decoder returns { type, raw, station, lines:[{raw,label,text,head?}], f:{fields} }.
   Lines are in report order so the UI can show token -> meaning. */
(function () {
  'use strict';

  // ---------- shared tables ----------
  const INTENSITY = { '-': 'light', '+': 'heavy', 'VC': 'in the vicinity' };
  const DESCRIPTOR = {
    MI: 'shallow', PR: 'partial', BC: 'patches of', DR: 'low drifting', BL: 'blowing',
    SH: 'showers', TS: 'thunderstorm', FZ: 'freezing'
  };
  const PRECIP = {
    DZ: 'drizzle', RA: 'rain', SN: 'snow', SG: 'snow grains', IC: 'ice crystals',
    PL: 'ice pellets', GR: 'hail', GS: 'small hail or snow pellets', UP: 'unknown precipitation'
  };
  const OBSCUR = {
    BR: 'mist', FG: 'fog', FU: 'smoke', VA: 'volcanic ash', DU: 'widespread dust',
    SA: 'sand', HZ: 'haze', PY: 'spray'
  };
  const OTHER = {
    PO: 'dust or sand whirls', SQ: 'squalls', FC: 'funnel cloud', SS: 'sandstorm', DS: 'duststorm'
  };
  const COVER = {
    SKC: 'sky clear', CLR: 'clear below 12,000 ft (automated)', NSC: 'no significant cloud',
    FEW: 'few clouds (1/8 to 2/8)', SCT: 'scattered clouds (3/8 to 4/8)',
    BKN: 'broken clouds (5/8 to 7/8)', OVC: 'overcast (8/8)'
  };
  const COVER_SHORT = { FEW: 'few', SCT: 'scattered', BKN: 'broken', OVC: 'overcast' };
  const DIRS = { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' };

  const WX_RE = /^(\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP)*)(BR|FG|FU|VA|DU|SA|HZ|PY)?(PO|SQ|FC|SS|DS)?$/;

  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function hhmm(h, m) { return pad2(h) + ':' + pad2(m) + 'Z'; }
  function ordinal(d) {
    const n = Number(d); const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function dirWord(d) { return DIRS[d] || d; }

  // Weather phenomenon group, e.g. "-TSRA" -> "thunderstorm with light rain"
  function decodeWx(tok) {
    const m = WX_RE.exec(tok);
    if (!m || tok === '' || (!m[2] && !m[3] && !m[4] && !m[5])) return null;
    const inten = m[1], desc = m[2], precipStr = m[3], obs = m[4], oth = m[5];
    const precips = precipStr ? precipStr.match(/.{2}/g).map(p => PRECIP[p]) : [];
    const pText = precips.join(' and ');
    const iWord = inten === '-' ? 'light ' : inten === '+' ? 'heavy ' : '';
    let text = '';
    if (desc === 'TS') {
      text = 'thunderstorm' + (pText ? ' with ' + iWord + pText : '');
    } else if (desc === 'SH') {
      text = iWord + (pText || 'precipitation') + ' showers';
    } else if (desc === 'FZ') {
      text = iWord + 'freezing ' + (pText || (obs ? OBSCUR[obs] : ''));
      if (obs && pText) text += ' and ' + OBSCUR[obs];
    } else if (desc) {
      text = iWord + DESCRIPTOR[desc] + ' ' + (pText || (obs ? OBSCUR[obs] : '') || (oth ? OTHER[oth] : ''));
    } else {
      text = iWord + pText;
    }
    const extras = [];
    if (obs && !(desc === 'FZ' || (desc && !pText && !oth))) extras.push(OBSCUR[obs]);
    if (oth && !(desc && !pText && !obs)) extras.push(inten === '+' && oth === 'FC' ? 'tornado or waterspout' : OTHER[oth]);
    if (!desc && !pText && extras.length) { text = ''; }
    text = [text.trim(), ...extras].filter(Boolean).join(', ');
    if (inten === 'VC') text += ' in the vicinity (5 to 10 SM from the station)';
    return { raw: tok, text: text, intensity: inten || null, descriptor: desc || null, precip: precips, obscuration: obs ? OBSCUR[obs] : null, other: oth || null };
  }

  function decodeWind(tok, nextTok) {
    const m = /^(VRB|\d{3})(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/.exec(tok);
    if (!m) return null;
    const unit = m[4] === 'KT' ? 'knots' : m[4] === 'MPS' ? 'meters per second' : 'km/h';
    const w = { raw: tok, dir: m[1] === 'VRB' ? 'VRB' : Number(m[1]), spd: Number(m[2]), gst: m[3] ? Number(m[3]) : null, unit: m[4], calm: false, varFrom: null, varTo: null };
    let text;
    if (w.dir === 0 && w.spd === 0) { w.calm = true; text = 'wind calm'; }
    else if (w.dir === 'VRB') text = 'wind variable in direction at ' + w.spd + ' ' + unit;
    else text = 'wind from ' + pad2(w.dir).padStart(3, '0') + '° true at ' + w.spd + ' ' + unit;
    if (w.gst) text += ', gusting to ' + w.gst + ' ' + unit;
    const v = nextTok && /^(\d{3})V(\d{3})$/.exec(nextTok);
    if (v) { w.varFrom = Number(v[1]); w.varTo = Number(v[2]); w.raw += ' ' + nextTok; text += '; direction varying between ' + v[1] + '° and ' + v[2] + '°'; }
    w.text = text;
    return w;
  }

  function fracToNum(s) {
    let total = 0;
    s.split(' ').forEach(p => {
      if (p.includes('/')) { const [a, b] = p.split('/'); total += Number(a) / Number(b); }
      else if (p) total += Number(p);
    });
    return total;
  }

  // returns {raw, sm, lessThan, greaterThan, text, consumed}
  function decodeVis(tokens, i) {
    const t = tokens[i];
    if (!t) return null;
    if (t === 'CAVOK') return { raw: t, sm: 6.3, text: 'ceiling and visibility OK: visibility 10 km or more, no significant cloud below 5,000 ft, no significant weather', consumed: 1 };
    // "1 1/2SM"
    if (/^\d$/.test(t) && tokens[i + 1] && /^\d\/\dSM$/.test(tokens[i + 1])) {
      const raw = t + ' ' + tokens[i + 1];
      const sm = fracToNum(raw.replace('SM', ''));
      return { raw, sm, text: 'visibility ' + raw.replace('SM', '') + ' statute miles', consumed: 2 };
    }
    const m = /^([MP])?(\d{1,2}(?:\/\d)?)SM$/.exec(t);
    if (m) {
      const num = fracToNum(m[2]);
      const v = { raw: t, sm: num, lessThan: m[1] === 'M', greaterThan: m[1] === 'P', consumed: 1 };
      v.text = 'visibility ' + (v.lessThan ? 'less than ' : v.greaterThan ? 'greater than ' : '') + m[2] + ' statute mile' + (num === 1 && !v.lessThan ? '' : 's');
      return v;
    }
    const mm = /^(\d{4})(NDV)?$/.exec(t);
    if (mm && tokens[i - 1] && /KT$|^\d{3}V\d{3}$/.test(tokens[i - 1])) {
      return { raw: t, sm: Number(mm[1]) / 1609, text: 'visibility ' + fmt(mm[1]) + ' meters', consumed: 1 };
    }
    return null;
  }

  function decodeRvr(tok) {
    const m = /^R(\d{2}[LRC]?)\/([MP])?(\d{4})(?:V([MP])?(\d{4}))?FT(?:\/([UDN]))?$/.exec(tok);
    if (!m) return null;
    const q = { M: 'less than ', P: 'more than ' };
    let text = 'runway visual range for runway ' + m[1].replace(/^0/, '') + ': ' + (q[m[2]] || '') + fmt(m[3]) + ' ft';
    if (m[5]) text += ' varying to ' + (q[m[4]] || '') + fmt(m[5]) + ' ft';
    if (m[6]) text += ', ' + { U: 'increasing', D: 'decreasing', N: 'no change' }[m[6]];
    return { raw: tok, runway: m[1], ft: Number(m[3]), text };
  }

  function decodeSky(tok) {
    if (COVER[tok] && !/\d/.test(tok)) return { raw: tok, cover: tok, base: null, type: null, text: COVER[tok] };
    let m = /^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$/.exec(tok);
    if (m) {
      const base = Number(m[2]) * 100;
      let text = COVER_SHORT[m[1]] + ' layer at ' + fmt(base) + ' ft AGL';
      if (m[3] === 'CB') text += ' (cumulonimbus)';
      if (m[3] === 'TCU') text += ' (towering cumulus)';
      return { raw: tok, cover: m[1], base, type: m[3] || null, text };
    }
    m = /^VV(\d{3})$/.exec(tok);
    if (m) {
      const base = Number(m[1]) * 100;
      return { raw: tok, cover: 'VV', base, type: null, text: 'sky obscured, vertical visibility ' + fmt(base) + ' ft' };
    }
    if (/^VV\/\/\/$/.test(tok)) return { raw: tok, cover: 'VV', base: null, type: null, text: 'sky obscured, vertical visibility not measurable' };
    return null;
  }

  function ceilingOf(sky) {
    let c = null;
    sky.forEach(l => { if ((l.cover === 'BKN' || l.cover === 'OVC' || l.cover === 'VV') && l.base != null && (c == null || l.base < c)) c = l.base; });
    return c;
  }

  function flightCategory(ceiling, visSm) {
    const c = ceiling == null ? Infinity : ceiling;
    const v = visSm == null ? Infinity : visSm;
    if (c < 500 || v < 1) return 'LIFR';
    if (c < 1000 || v < 3) return 'IFR';
    if (c <= 3000 || v <= 5) return 'MVFR';
    return 'VFR';
  }

  function decodeTemp(tok) {
    const m = /^(M?\d{2})\/(M?\d{2})?$/.exec(tok);
    if (!m) return null;
    const t = m[1].startsWith('M') ? -Number(m[1].slice(1)) : Number(m[1]);
    const d = m[2] == null ? null : m[2].startsWith('M') ? -Number(m[2].slice(1)) : Number(m[2]);
    let text = 'temperature ' + t + '°C';
    text += d == null ? ', dew point missing' : ', dew point ' + d + '°C';
    return { raw: tok, temp: t, dewp: d, text };
  }

  function decodeAltim(tok) {
    let m = /^A(\d{4})$/.exec(tok);
    if (m) { const v = Number(m[1]) / 100; return { raw: tok, inHg: v, text: 'altimeter ' + v.toFixed(2) + ' inches of mercury' }; }
    m = /^Q(\d{4})$/.exec(tok);
    if (m) { const v = Number(m[1]); return { raw: tok, hPa: v, inHg: v / 33.8639, text: 'altimeter ' + v + ' hectopascals (QNH)' }; }
    return null;
  }

  function decodeTime(tok) {
    const m = /^(\d{2})(\d{2})(\d{2})Z$/.exec(tok);
    if (!m) return null;
    return { raw: tok, day: Number(m[1]), hh: Number(m[2]), mm: Number(m[3]), text: 'observed on the ' + ordinal(m[1]) + ' of the month at ' + hhmm(m[2], m[3]) + ' (UTC)' };
  }

  // ---------- METAR remarks ----------
  function slpText(v) { const n = Number(v); const hpa = (n < 500 ? 1000 : 900) + n / 10; return { hPa: hpa, text: 'sea level pressure ' + hpa.toFixed(1) + ' hPa' }; }
  function tenths(sign, val) { const n = Number(val) / 10; return sign === '1' ? -n : n; }
  function timeTok(s) { return s.length === 4 ? hhmm(s.slice(0, 2), s.slice(2)) : 'minute ' + s + ' past the hour'; }

  function decodeRemarks(tokens, f) {
    const lines = [];
    const rmk = f.rmk;
    let i = 0;
    const take = (n, raw, text) => { lines.push({ raw, label: 'Remark', text }); i += n; };
    while (i < tokens.length) {
      const t = (tokens[i] || '').replace(/;$/, ''), t1 = tokens[i + 1] || '', t2 = tokens[i + 2] || '', t3 = tokens[i + 3] || '';
      let m;
      if (t === 'AO1' || t === 'A01') { take(1, t, 'automated station without a precipitation discriminator (cannot tell rain from snow)' + (t === 'A01' ? '; written with a zero here, the standard form is AO1' : '')); continue; }
      if (t === 'AO2' || t === 'A02') { take(1, t, 'automated station with a precipitation discriminator (can tell rain from snow)' + (t === 'A02' ? '; written with a zero here, the standard form is AO2' : '')); continue; }
      if (t === 'AO2A' || t === 'AO1A') { take(1, t, 'automated station (' + t.slice(0, 3) + ') augmented by a human observer'); continue; }
      if ((m = /^RH\/(\d{1,3})$/.exec(t))) { take(1, t, 'relative humidity ' + m[1] + '%'); continue; }
      if (t === 'CIG' && /^\d{3}$/.test(t1) && /^[NESW]{1,2}$/.test(t2)) { take(3, [t, t1, t2].join(' '), 'ceiling ' + fmt(Number(t1) * 100) + ' ft in the ' + dirWord(t2) + ' sector'); continue; }
      if ((m = /^SLP(\d{3})$/.exec(t))) { const s = slpText(m[1]); rmk.slp = s.hPa; take(1, t, s.text); continue; }
      if (t === 'SLPNO') { take(1, t, 'sea level pressure not available'); continue; }
      if ((m = /^T(\d)(\d{3})(\d)(\d{3})$/.exec(t))) {
        rmk.tempExact = tenths(m[1], m[2]); rmk.dewpExact = tenths(m[3], m[4]);
        take(1, t, 'hourly temperature ' + rmk.tempExact.toFixed(1) + '°C and dew point ' + rmk.dewpExact.toFixed(1) + '°C to the tenth of a degree');
        continue;
      }
      if (t === 'PK' && t1 === 'WND' && (m = /^(\d{3})(\d{2,3})\/(\d{2,4})$/.exec(t2))) {
        rmk.pkWnd = { dir: Number(m[1]), spd: Number(m[2]), time: m[3] };
        take(3, [t, t1, t2].join(' '), 'peak wind from ' + m[1] + '° at ' + Number(m[2]) + ' knots, occurred at ' + timeTok(m[3]));
        continue;
      }
      if (t === 'WSHFT' && /^\d{2,4}$/.test(t1)) {
        const fropa = t2 === 'FROPA';
        take(fropa ? 3 : 2, [t, t1, fropa ? t2 : ''].join(' ').trim(), 'wind shift began at ' + timeTok(t1) + (fropa ? ', due to frontal passage' : ''));
        continue;
      }
      if (t === 'TWR' && t1 === 'VIS') { const v = decodeVis(tokens, i + 2); const raw = [t, t1, v ? v.raw : t2].join(' '); take(2 + (v ? v.consumed : 1), raw, 'tower visibility ' + (v ? v.raw.replace('SM', '') : t2) + ' statute miles'); continue; }
      if (t === 'SFC' && t1 === 'VIS') { const v = decodeVis(tokens, i + 2); const raw = [t, t1, v ? v.raw : t2].join(' '); take(2 + (v ? v.consumed : 1), raw, 'surface visibility ' + (v ? v.raw.replace('SM', '') : t2) + ' statute miles'); continue; }
      if (t === 'VIS' && (m = /^(\d+(?:\/\d)?)V(\d+(?:\/\d)?)$/.exec(t1))) { take(2, t + ' ' + t1, 'visibility variable between ' + m[1] + ' and ' + m[2] + ' statute miles'); continue; }
      if (t === 'VIS' && /^\d$/.test(t1) && (m = /^(\d\/\d)V(\d+(?:\/\d)?)$/.exec(t2))) { take(3, [t, t1, t2].join(' '), 'visibility variable between ' + t1 + ' ' + m[1] + ' and ' + m[2] + ' statute miles'); continue; }
      if (t === 'VIS' && /^[NESW]{1,2}$/.test(t1)) { take(3, [t, t1, t2].join(' '), 'visibility toward the ' + dirWord(t1) + ' is ' + t2 + ' statute miles'); continue; }
      if (t === 'CIG' && (m = /^(\d{3})V(\d{3})$/.exec(t1))) { take(2, t + ' ' + t1, 'ceiling variable between ' + fmt(Number(m[1]) * 100) + ' and ' + fmt(Number(m[2]) * 100) + ' ft'); continue; }
      if (t === 'CIG' && /^\d{3}$/.test(t1) && /^RWY/.test(t2)) { take(3, [t, t1, t2].join(' '), 'ceiling ' + fmt(Number(t1) * 100) + ' ft at the ' + t2.replace('RWY', 'runway ') + ' end'); continue; }
      if (/^(FEW|SCT|BKN|OVC)$/.test(t) && t1 === 'V' && /^(FEW|SCT|BKN|OVC)$/.test(t2)) { take(3, [t, t1, t2].join(' '), 'sky condition varying between ' + COVER_SHORT[t] + ' and ' + COVER_SHORT[t2]); continue; }
      if ((m = /^(FEW|SCT|BKN|OVC)(\d{3})$/.exec(t)) && t1 === 'V' && /^(FEW|SCT|BKN|OVC)$/.test(t2)) { take(3, [t, t1, t2].join(' '), 'layer at ' + fmt(Number(m[2]) * 100) + ' ft varying between ' + COVER_SHORT[m[1]] + ' and ' + COVER_SHORT[t2]); continue; }
      if (t === 'PRESRR') { take(1, t, 'pressure rising rapidly'); continue; }
      if (t === 'PRESFR') { take(1, t, 'pressure falling rapidly'); continue; }
      if (t === 'FROPA') { take(1, t, 'frontal passage'); continue; }
      if ((m = /^P(\d{4})$/.exec(t))) { rmk.precip1h = Number(m[1]) / 100; take(1, t, 'precipitation in the last hour: ' + (Number(m[1]) === 0 ? 'a trace (less than 0.01 in)' : (Number(m[1]) / 100).toFixed(2) + ' inches')); continue; }
      if ((m = /^6(\d{4})$/.exec(t))) { take(1, t, '3- or 6-hour precipitation: ' + (m[1] === '////' ? 'indeterminate' : (Number(m[1]) / 100).toFixed(2) + ' inches')); continue; }
      if ((m = /^7(\d{4})$/.exec(t))) { take(1, t, '24-hour precipitation: ' + (Number(m[1]) / 100).toFixed(2) + ' inches'); continue; }
      if ((m = /^4\/(\d{3})$/.exec(t))) { take(1, t, 'snow depth on the ground: ' + Number(m[1]) + ' inches'); continue; }
      if ((m = /^931(\d{3})$/.exec(t))) { take(1, t, '6-hour snowfall: ' + (Number(m[1]) / 10).toFixed(1) + ' inches'); continue; }
      if ((m = /^933(\d{3})$/.exec(t))) { take(1, t, 'water equivalent of snow on the ground: ' + (Number(m[1]) / 10).toFixed(1) + ' inches'); continue; }
      if ((m = /^1(\d)(\d{3})$/.exec(t))) { take(1, t, '6-hour maximum temperature ' + tenths(m[1], m[2]).toFixed(1) + '°C'); continue; }
      if ((m = /^2(\d)(\d{3})$/.exec(t))) { take(1, t, '6-hour minimum temperature ' + tenths(m[1], m[2]).toFixed(1) + '°C'); continue; }
      if ((m = /^4(\d)(\d{3})(\d)(\d{3})$/.exec(t))) { take(1, t, '24-hour maximum ' + tenths(m[1], m[2]).toFixed(1) + '°C and minimum ' + tenths(m[3], m[4]).toFixed(1) + '°C'); continue; }
      if ((m = /^5(\d)(\d{3})$/.exec(t))) {
        const tend = ['increasing, then decreasing', 'increasing, then steady', 'increasing steadily', 'increasing, then increasing faster', 'steady', 'decreasing, then increasing', 'decreasing, then steady', 'decreasing steadily', 'decreasing, then decreasing faster'][Number(m[1])];
        take(1, t, '3-hour pressure tendency: ' + tend + ', change of ' + (Number(m[2]) / 10).toFixed(1) + ' hPa'); continue;
      }
      if ((m = /^8\/(\d|\/)(\d|\/)(\d|\/)$/.exec(t))) { take(1, t, 'cloud types code: low ' + m[1] + ', middle ' + m[2] + ', high ' + m[3]); continue; }
      if ((m = /^98(\d{3})$/.exec(t))) { take(1, t, 'sunshine duration ' + Number(m[1]) + ' minutes'); continue; }
      if ((m = beginEnd(t))) { take(1, t, m); continue; }
      if (/^(FRQ|OCNL|CONS)$/.test(t) && /^LTG/.test(t1)) {
        const freq = { FRQ: 'frequent', OCNL: 'occasional', CONS: 'continuous' }[t];
        const res = ltg(tokens, i + 1); take(1 + res.n, t + ' ' + res.raw, freq + ' ' + res.text); continue;
      }
      if (/^LTG/.test(t)) { const res = ltg(tokens, i); take(res.n, res.raw, res.text); continue; }
      if (/^(TS|CB|TCU|ACSL|ACC|SC|CU|VIRGA|FG|FU|BLSN|BLDU|ROTOR|CLD|CBMAM|SH|RA|SN)$/.test(t) && /^(DSNT|OHD|VC|ALQDS|OVHD|[NESW]{1,2}|MOV|AND|ALQS|BKN|SCT|TOP|TOPS|BASES)/.test(t1 || '')) {
        const words = { TS: 'thunderstorm', CB: 'cumulonimbus', TCU: 'towering cumulus', ACSL: 'standing lenticular altocumulus', ACC: 'altocumulus castellanus', SC: 'stratocumulus', CU: 'cumulus', VIRGA: 'virga', FG: 'fog', FU: 'smoke', BLSN: 'blowing snow', BLDU: 'blowing dust', ROTOR: 'rotor cloud', CLD: 'cloud', CBMAM: 'cumulonimbus mammatus', SH: 'showers', RA: 'rain', SN: 'snow' };
        const res = locPhrase(tokens, i + 1); take(1 + res.n, t + ' ' + res.raw, words[t] + ' ' + res.text); continue;
      }
      if (t === 'SNINCR' && (m = /^(\d+)\/(\d+)$/.exec(t1))) { take(2, t + ' ' + t1, 'snow increasing rapidly: ' + m[1] + ' inch(es) in the last hour, ' + m[2] + ' inches on the ground'); continue; }
      if (t === 'HLSTO' && t1) { take(2, t + ' ' + t1, 'hailstones ' + t1 + ' inch in diameter'); continue; }
      if (t === 'WND' && t1 === 'DATA' && t2 === 'ESTMD') { take(3, 'WND DATA ESTMD', 'wind data estimated'); continue; }
      if (t === 'ACFT' && t1 === 'MSHP') { take(2, 'ACFT MSHP', 'aircraft mishap'); continue; }
      if (t === 'FUNNEL' && t1 === 'CLOUD') { const res = locPhrase(tokens, i + 2); take(2 + res.n, ('FUNNEL CLOUD ' + res.raw).trim(), 'funnel cloud ' + res.text); continue; }
      if (t === 'TORNADO' || t === 'WATERSPOUT') { const res = locPhrase(tokens, i + 1); take(1 + res.n, (t + ' ' + res.raw).trim(), t.toLowerCase() + ' ' + res.text); continue; }
      if (t === 'NOSPECI') { take(1, t, 'no SPECI reports are taken at this station'); continue; }
      if (t === 'LAST') { take(1, t, 'last observation before a break in coverage'); continue; }
      if (t === 'FIRST') { take(1, t, 'first observation after a break in coverage'); continue; }
      if (t === '$') { take(1, t, 'maintenance check indicator: the automated station needs servicing'); continue; }
      if ((m = /^(RVR|PWI|P|FZRA|TS|VIS|CHI|SLP)NO$/.exec(t))) {
        const s = { RVR: 'runway visual range', PWI: 'present weather identifier', P: 'precipitation amount', FZRA: 'freezing rain sensor', TS: 'thunderstorm/lightning sensor', VIS: 'visibility', CHI: 'ceiling height indicator', SLP: 'sea level pressure' }[m[1]];
        take(1, t, s + ' not available'); continue;
      }
      if (t === 'RMK') { i++; continue; }
      if (t === 'AO2' || t === 'AUTO') { i++; continue; }
      if (t === 'MOV' && t1) { take(2, t + ' ' + t1, 'moving toward the ' + dirWord(t1)); continue; }
      if (/^(DSNT|OHD|VC|ALQDS)$/.test(t)) { const res = locPhrase(tokens, i); take(res.n, res.raw, res.text); continue; }
      // unknown: group consecutive undecoded tokens
      let j = i + 1;
      while (j < tokens.length && !knownRemark(tokens, j)) j++;
      lines.push({ raw: tokens.slice(i, j).join(' '), label: 'Remark', text: 'not decoded here (plain-language or station-specific remark)' });
      i = j;
    }
    return lines;
  }

  // "RAB1959", "TSE1858B26E41RAB1857", "SNEMM" -> begin/end times, possibly several phenomena in one token
  const BE_RE = /([+-]?(?:TS|SH|FZ|BL|DR)?(?:RA|SN|DZ|PL|GR|GS|SG|IC|UP|FG|BR|HZ|FU|TS|SQ|FC))((?:[BE](?:\d{2,4}|MM))+)/g;
  function beginEnd(tok) {
    if (!/^(?:[+-]?[A-Z]{2,6}(?:[BE](?:\d{2,4}|MM))+)+$/.test(tok)) return null;
    const parts = []; let consumed = 0; let m;
    BE_RE.lastIndex = 0;
    while ((m = BE_RE.exec(tok))) {
      const w = decodeWx(m[1]); if (!w) return null;
      consumed += m[0].length;
      const times = m[2].match(/[BE](?:\d{2,4}|MM)/g).map(p => (p[0] === 'B' ? 'began' : 'ended') + ' at ' + (p.slice(1) === 'MM' ? 'an unknown time (missing)' : timeTok(p.slice(1))));
      parts.push(w.text + ' ' + times.join(', '));
    }
    return consumed === tok.length && parts.length ? parts.join('; ') : null;
  }

  function knownRemark(tokens, j) {
    const t = (tokens[j] || '').replace(/;$/, '');
    if (beginEnd(t) || /^(A0[12]|RH\/\d+)$/.test(t)) return true;
    return /^(AO[12]A?|SLP\d{3}|SLPNO|T\d{8}|PK|WSHFT|TWR|SFC|VIS|CIG|PRESRR|PRESFR|FROPA|P\d{4}|6\d{4}|7\d{4}|4\/\d{3}|93[13]\d{3}|[12]\d{4}|4\d{8}|5\d{4}|8\/...|98\d{3}|LTG\w*|FRQ|OCNL|CONS|SNINCR|HLSTO|WND|ACFT|FUNNEL|TORNADO|WATERSPOUT|NOSPECI|LAST|FIRST|\$|\w+NO|FEW|SCT|BKN|OVC|TS|CB|TCU|ACSL|VIRGA|MOV|DSNT|OHD|VC)$/.test(t)
      || /^([+-]?(?:[A-Z]{2}){1,3})((?:[BE]\d{2,4})+)$/.test(t);
  }

  function ltg(tokens, i) {
    // LTG, LTGIC, LTGCG, LTGICCG ... followed by location phrase
    const t = tokens[i];
    const types = [];
    const rest = t.slice(3);
    if (rest.includes('IC')) types.push('in-cloud');
    if (rest.includes('CG')) types.push('cloud-to-ground');
    if (rest.includes('CC')) types.push('cloud-to-cloud');
    if (rest.includes('CA')) types.push('cloud-to-air');
    const res = locPhrase(tokens, i + 1);
    return { n: 1 + res.n, raw: (t + ' ' + res.raw).trim(), text: ('lightning' + (types.length ? ' (' + types.join(', ') + ')' : '') + ' ' + res.text).trim() };
  }

  function locPhrase(tokens, i) {
    // DSNT NW AND S, OHD, VC, ALQDS, N-NE, MOV E, "W MOV E" ...
    const parts = []; let n = 0; let j = i;
    while (j < tokens.length) {
      const t = tokens[j];
      if (t === 'DSNT') parts.push('distant (more than 10 SM)');
      else if (t === 'OHD' || t === 'OVHD') parts.push('overhead');
      else if (t === 'VC') parts.push('in the vicinity');
      else if (t === 'ALQDS' || t === 'ALQS') parts.push('in all quadrants');
      else if (t === 'AND') parts.push('and');
      else if (t === 'THRU' || t === 'THU') parts.push('through');
      else if (t === 'MOV' && tokens[j + 1]) { parts.push('moving toward the ' + dirWord(tokens[j + 1])); j += 2; n += 2; continue; }
      else if (/^[NESW]{1,2}(-[NESW]{1,2})*$/.test(t)) parts.push('to the ' + t.split('-').map(dirWord).join(' through '));
      else if (/^(BKN|SCT|FEW|OVC)$/.test(t)) parts.push(COVER_SHORT[t]);
      else if (/^(TOP|TOPS)$/.test(t) && /^\d{3}$/.test(tokens[j + 1] || '')) { parts.push('tops ' + fmt(Number(tokens[j + 1]) * 100) + ' ft'); j += 2; n += 2; continue; }
      else break;
      j++; n++;
    }
    return { n, raw: tokens.slice(i, i + n).join(' '), text: parts.join(' ') };
  }

  // ---------- METAR ----------
  function metar(raw) {
    raw = raw.replace(/\s+/g, ' ').trim().replace(/=$/, '');
    const tokens = raw.split(' ');
    const f = { type: 'METAR', station: null, time: null, auto: false, cor: false, wind: null, vis: null, rvr: [], wx: [], sky: [], temp: null, dewp: null, altim: null, rmk: {}, remarksRaw: '' };
    const lines = [];
    let i = 0;
    if (tokens[i] === 'METAR' || tokens[i] === 'SPECI') {
      f.type = tokens[i];
      lines.push({ raw: tokens[i], label: 'Report type', text: f.type === 'SPECI' ? 'SPECI: special (unscheduled) observation issued because conditions changed significantly' : 'METAR: routine hourly aviation weather observation' });
      i++;
    } else {
      lines.push({ raw: '(METAR)', label: 'Report type', text: 'routine hourly aviation weather observation (type prefix omitted)' });
    }
    if (/^[A-Z0-9]{4}$/.test(tokens[i] || '')) { f.station = tokens[i]; lines.push({ raw: tokens[i], label: 'Station', text: 'ICAO station identifier ' + tokens[i] + (tokens[i][0] === 'K' ? ' (K prefix = contiguous United States)' : tokens[i].startsWith('PA') ? ' (PA prefix = Alaska)' : tokens[i].startsWith('PH') ? ' (PH prefix = Hawaii)' : '') }); i++; }
    const tm = decodeTime(tokens[i] || '');
    if (tm) { f.time = tm; lines.push({ raw: tm.raw, label: 'Date/time', text: tm.text }); i++; }
    while (tokens[i] === 'AUTO' || tokens[i] === 'COR' || tokens[i] === 'NIL') {
      if (tokens[i] === 'AUTO') { f.auto = true; lines.push({ raw: 'AUTO', label: 'Modifier', text: 'fully automated report with no human intervention' }); }
      if (tokens[i] === 'COR') { f.cor = true; lines.push({ raw: 'COR', label: 'Modifier', text: 'corrected observation' }); }
      if (tokens[i] === 'NIL') lines.push({ raw: 'NIL', label: 'Modifier', text: 'no observation available' });
      i++;
    }
    const rmkAt = tokens.indexOf('RMK');
    const bodyEnd = rmkAt === -1 ? tokens.length : rmkAt;
    while (i < bodyEnd) {
      const t = tokens[i];
      let x;
      if (!f.wind && (x = decodeWind(t, tokens[i + 1]))) { f.wind = x; lines.push({ raw: x.raw, label: 'Wind', text: x.text }); i += x.varFrom != null ? 2 : 1; continue; }
      if (!f.vis && (x = decodeVis(tokens, i))) { f.vis = x; lines.push({ raw: x.raw, label: 'Visibility', text: x.text }); i += x.consumed; continue; }
      if ((x = decodeRvr(t))) { f.rvr.push(x); lines.push({ raw: t, label: 'RVR', text: x.text }); i++; continue; }
      if ((x = decodeSky(t))) { f.sky.push(x); lines.push({ raw: t, label: 'Sky', text: x.text }); i++; continue; }
      if ((x = decodeWx(t))) { f.wx.push(x); lines.push({ raw: t, label: 'Weather', text: x.text }); i++; continue; }
      if (f.temp == null && (x = decodeTemp(t))) { f.temp = x.temp; f.dewp = x.dewp; lines.push({ raw: t, label: 'Temp/dew point', text: x.text }); i++; continue; }
      if ((x = decodeAltim(t))) { f.altim = x.inHg; f.altimRaw = x; lines.push({ raw: t, label: 'Altimeter', text: x.text }); i++; continue; }
      if (/^(\d{3})V(\d{3})$/.test(t)) { i++; continue; }
      if (t === 'NOSIG') { lines.push({ raw: t, label: 'Trend', text: 'no significant change expected' }); i++; continue; }
      lines.push({ raw: t, label: 'Unknown', text: 'not decoded' });
      i++;
    }
    if (rmkAt !== -1) {
      f.remarksRaw = tokens.slice(rmkAt + 1).join(' ');
      lines.push({ raw: 'RMK', label: 'Remarks', text: 'remarks section begins (additional data, automated-station info, pressure, precise temperatures)', head: true });
      lines.push(...decodeRemarks(tokens.slice(rmkAt + 1), f));
    }
    f.ceiling = ceilingOf(f.sky);
    f.visSm = f.vis ? f.vis.sm : null;
    f.fltCat = flightCategory(f.ceiling, f.visSm);
    f.spread = f.temp != null && f.dewp != null ? f.temp - f.dewp : null;
    return { type: 'METAR', raw, station: f.station, lines, f };
  }

  // ---------- TAF ----------
  function decodeGroupElements(tokens, g, lines) {
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      let x;
      if (!g.wind && (x = decodeWind(t, tokens[i + 1]))) { g.wind = x; lines.push({ raw: x.raw, label: 'Wind', text: x.text }); i += x.varFrom != null ? 2 : 1; continue; }
      if (!g.vis && (x = decodeVis(tokens, i))) { g.vis = x; lines.push({ raw: x.raw, label: 'Visibility', text: x.text }); i += x.consumed; continue; }
      if ((x = decodeSky(t))) { g.sky.push(x); lines.push({ raw: t, label: 'Sky', text: x.text }); i++; continue; }
      if ((x = decodeWx(t))) { g.wx.push(x); lines.push({ raw: t, label: 'Weather', text: x.text }); i++; continue; }
      if (t === 'NSW') { g.nsw = true; lines.push({ raw: t, label: 'Weather', text: 'no significant weather (previous weather ends)' }); i++; continue; }
      let m = /^WS(\d{3})\/(\d{3})(\d{2,3})KT$/.exec(t);
      if (m) {
        g.ws = { hgt: Number(m[1]) * 100, dir: Number(m[2]), spd: Number(m[3]) };
        lines.push({ raw: t, label: 'Wind shear', text: 'low-level wind shear: at ' + fmt(g.ws.hgt) + ' ft AGL the wind is from ' + m[2] + '° at ' + Number(m[3]) + ' knots' }); i++; continue;
      }
      if (/^(\d{3})V(\d{3})$/.test(t)) { i++; continue; }
      if ((m = /^(QNH|)(\d{4})INS$/.exec(t))) { lines.push({ raw: t, label: 'Altimeter', text: 'forecast lowest altimeter ' + (Number(m[2]) / 100).toFixed(2) + ' inHg (military TAF format)' }); i++; continue; }
      if ((m = /^T([XN])?(M?\d{2})\/(\d{2})(\d{2})Z$/.exec(t))) { lines.push({ raw: t, label: 'Temperature', text: 'forecast ' + (m[1] === 'X' ? 'maximum' : m[1] === 'N' ? 'minimum' : '') + ' temperature ' + m[2].replace('M', '-') + '°C at ' + m[4] + '00Z on the ' + ordinal(m[3]) + ' (military TAF format)' }); i++; continue; }
      if ((m = /^5(\d)(\d{3})(\d)$/.exec(t))) {
        const tb = ['none', 'light', 'moderate in clear air, occasional', 'moderate in clear air, frequent', 'moderate in cloud, occasional', 'moderate in cloud, frequent', 'severe in clear air, occasional', 'severe in clear air, frequent', 'severe in cloud, occasional', 'severe in cloud, frequent'][Number(m[1])];
        lines.push({ raw: t, label: 'Turbulence', text: 'turbulence ' + tb + ', from ' + fmt(Number(m[2]) * 100) + ' ft AGL through a layer ' + fmt(Number(m[3]) * 1000) + ' ft thick (military TAF format)' }); i++; continue;
      }
      if ((m = /^6(\d)(\d{3})(\d)$/.exec(t))) {
        const ic = ['none', 'light', 'light rime in cloud', 'light clear in precipitation', 'moderate', 'moderate rime in cloud', 'moderate clear in precipitation', 'severe', 'severe rime in cloud', 'severe clear in precipitation'][Number(m[1])];
        lines.push({ raw: t, label: 'Icing', text: 'icing ' + ic + ', from ' + fmt(Number(m[2]) * 100) + ' ft AGL through a layer ' + fmt(Number(m[3]) * 1000) + ' ft thick (military TAF format)' }); i++; continue;
      }
      if (t === 'WND' && /KT$/.test(tokens[i + 1] || '') && tokens[i + 2] === 'AFT' && /^\d{4}$/.test(tokens[i + 3] || '')) {
        const w = decodeWind(tokens[i + 1]);
        lines.push({ raw: tokens.slice(i, i + 4).join(' '), label: 'Wind', text: (w ? w.text : tokens[i + 1]) + ' after ' + tokens[i + 3].slice(0, 2) + ':' + tokens[i + 3].slice(2) + 'Z (military TAF format)' }); i += 4; continue;
      }
      if (/^\d{4}$/.test(t) && !g.vis) { g.vis = { raw: t, sm: Number(t) / 1609, text: 'visibility ' + fmt(t) + ' meters' + (t === '9999' ? ' (10 km or more)' : '') }; lines.push({ raw: t, label: 'Visibility', text: g.vis.text }); i++; continue; }
      if (t === 'CAVOK') { lines.push({ raw: t, label: 'Conditions', text: 'ceiling and visibility OK' }); i++; continue; }
      lines.push({ raw: t, label: 'Unknown', text: 'not decoded' });
      i++;
    }
  }

  function groupHeaderText(g) {
    const period = g.from && g.to ? 'from ' + pad2(g.from.hr) + '00Z on the ' + ordinal(g.from.day) + ' until ' + pad2(g.to.hr) + '00Z on the ' + ordinal(g.to.day) : '';
    switch (g.kind) {
      case 'FM': return 'FROM ' + hhmm(g.from.hr, g.from.min) + ' on the ' + ordinal(g.from.day) + ': a rapid, permanent change; everything that follows replaces the previous forecast';
      case 'TEMPO': return 'TEMPORARY conditions ' + period + ': fluctuations lasting less than an hour at a time and, in total, less than half the period';
      case 'BECMG': return 'BECOMING: a gradual change taking place ' + period + '; the new conditions prevail after the end of the period';
      case 'PROB': return g.prob + '% PROBABILITY of the following conditions ' + period + (g.tempo ? ' (temporary)' : '');
      default: return '';
    }
  }

  function taf(raw) {
    raw = raw.replace(/\s+/g, ' ').trim().replace(/=$/, '');
    const tokens = raw.split(' ');
    const f = { station: null, amd: false, cor: false, issue: null, valid: null, groups: [], nil: false, cnl: false, remarks: '' };
    const lines = [];
    let i = 0;
    if (tokens[i] === 'TAF') { lines.push({ raw: 'TAF', label: 'Report type', text: 'Terminal Aerodrome Forecast: expected conditions within 5 statute miles of the airport' }); i++; }
    while (tokens[i] === 'AMD' || tokens[i] === 'COR') {
      if (tokens[i] === 'AMD') { f.amd = true; lines.push({ raw: 'AMD', label: 'Modifier', text: 'amended forecast (replaces the previously issued TAF)' }); }
      else { f.cor = true; lines.push({ raw: 'COR', label: 'Modifier', text: 'corrected forecast' }); }
      i++;
    }
    if (/^[A-Z0-9]{4}$/.test(tokens[i] || '')) { f.station = tokens[i]; lines.push({ raw: tokens[i], label: 'Station', text: 'ICAO station identifier ' + tokens[i] }); i++; }
    let m = /^(\d{2})(\d{2})(\d{2})Z$/.exec(tokens[i] || '');
    if (m) { f.issue = { day: Number(m[1]), hh: Number(m[2]), mm: Number(m[3]) }; lines.push({ raw: tokens[i], label: 'Issued', text: 'issued on the ' + ordinal(m[1]) + ' at ' + hhmm(m[2], m[3]) }); i++; }
    if (tokens[i] === 'NIL') { f.nil = true; lines.push({ raw: 'NIL', label: 'Status', text: 'no forecast available' }); i++; }
    m = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(tokens[i] || '');
    if (m) {
      const fd = Number(m[1]), fh = Number(m[2]), td = Number(m[3]), th = Number(m[4]);
      let hours = (td - fd) * 24 + (th - fh); if (hours <= 0) hours += 24 * 30;
      f.valid = { fromDay: fd, fromHr: fh, toDay: td, toHr: th, hours };
      lines.push({ raw: tokens[i], label: 'Valid period', text: 'valid from ' + pad2(fh) + '00Z on the ' + ordinal(fd) + ' until ' + pad2(th) + '00Z on the ' + ordinal(td) + ' (' + hours + ' hours)' });
      i++;
    }
    if (tokens[i] === 'CNL') { f.cnl = true; lines.push({ raw: 'CNL', label: 'Status', text: 'forecast cancelled' }); i++; }
    // base group
    let g = { kind: 'BASE', from: f.valid ? { day: f.valid.fromDay, hr: f.valid.fromHr, min: 0 } : null, to: null, wind: null, vis: null, wx: [], sky: [], ws: null, nsw: false, raw: '' };
    let buf = [];
    const flush = () => {
      if (g.kind !== 'BASE' || buf.length) {
        g.raw = (g.hdr ? g.hdr + ' ' : '') + buf.join(' ');
        if (g.kind !== 'BASE') lines.push({ raw: g.hdr, label: g.kind === 'PROB' ? 'PROB' + g.prob : g.kind, text: groupHeaderText(g), head: true });
        else lines.push({ raw: '', label: 'Base forecast', text: 'conditions expected at the start of the valid period', head: true });
        decodeGroupElements(buf, g, lines);
        g.ceiling = ceilingOf(g.sky);
        f.groups.push(g);
      }
      buf = [];
    };
    while (i < tokens.length) {
      const t = tokens[i];
      let mm;
      if ((mm = /^FM(\d{2})(\d{2})(\d{2})$/.exec(t))) {
        flush();
        g = { kind: 'FM', hdr: t, from: { day: Number(mm[1]), hr: Number(mm[2]), min: Number(mm[3]) }, to: null, wind: null, vis: null, wx: [], sky: [], ws: null, nsw: false };
        i++; continue;
      }
      if (t === 'TEMPO' || t === 'BECMG' || /^PROB\d{2}$/.test(t)) {
        flush();
        let kind = t.startsWith('PROB') ? 'PROB' : t;
        let hdr = t; let j = i + 1; let tempo = false;
        if (kind === 'PROB' && tokens[j] === 'TEMPO') { tempo = true; hdr += ' TEMPO'; j++; }
        const pm = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(tokens[j] || '');
        g = { kind, prob: kind === 'PROB' ? Number(t.slice(4)) : null, tempo, hdr: hdr + (pm ? ' ' + tokens[j] : ''), from: pm ? { day: Number(pm[1]), hr: Number(pm[2]), min: 0 } : null, to: pm ? { day: Number(pm[3]), hr: Number(pm[4]) } : null, wind: null, vis: null, wx: [], sky: [], ws: null, nsw: false };
        i = pm ? j + 1 : j; continue;
      }
      if (t === 'AMD' || t === 'RMK') { flush(); f.remarks = tokens.slice(i).join(' '); lines.push({ raw: f.remarks, label: 'Remark', text: t === 'AMD' ? amdText(f.remarks) : 'remarks' , head: false }); i = tokens.length; break; }
      buf.push(t); i++;
    }
    flush();
    return { type: 'TAF', raw, station: f.station, lines, f };
  }

  function amdText(s) {
    if (/AMD NOT SKED/.test(s)) return 'amendments are not scheduled (no observations available to update this forecast)' + (/AFT|TIL/.test(s) ? ': ' + s.replace('AMD NOT SKED', '').trim().toLowerCase() : '');
    if (/AMD LTD TO/.test(s)) return 'amendments limited to ' + s.replace('AMD LTD TO', '').trim().toLowerCase().replace('cld', 'cloud').replace('vis', 'visibility').replace('til', 'until');
    return 'amendment note: ' + s;
  }

  // Prevailing conditions at a given day/hour (ignores TEMPO/PROB), per FM/BECMG rules.
  function tafPrevailingAt(f, day, hr, min) {
    min = min || 0;
    const t = day * 1440 + hr * 60 + min;
    const key = g => g.from.day * 1440 + g.from.hr * 60 + (g.from.min || 0);
    let state = null;
    f.groups.forEach(g => {
      if (g.kind === 'BASE') state = Object.assign({}, g);
      else if (g.kind === 'FM' && key(g) <= t) state = Object.assign({}, g);
      else if (g.kind === 'BECMG' && g.to && (g.to.day * 1440 + g.to.hr * 60) <= t && state) {
        if (g.wind) state.wind = g.wind; if (g.vis) state.vis = g.vis; if (g.sky.length) { state.sky = g.sky; state.ceiling = g.ceiling; } if (g.wx.length) state.wx = g.wx; if (g.nsw) state.wx = [];
      }
    });
    return state;
  }

  // ---------- PIREP ----------
  const TURB = { NEG: 'none', SMOOTH: 'smooth', SMTH: 'smooth', LGT: 'light', MOD: 'moderate', SEV: 'severe', EXTRM: 'extreme', EXTRME: 'extreme', CHOP: 'chop', CAT: 'clear-air turbulence', CONS: 'continuous', OCNL: 'occasional', INTMT: 'intermittent', LLWS: 'low-level wind shear', 'LGT-MOD': 'light to moderate', 'MOD-SEV': 'moderate to severe', 'SEV-EXTRM': 'severe to extreme', TRACE: 'trace', TRC: 'trace', RIME: 'rime', CLR: 'clear', MX: 'mixed', MXD: 'mixed', NONE: 'none', ISOL: 'isolated', DURC: 'during climb', DURD: 'during descent', BLO: 'below', ABV: 'above', 'ABV-FL': 'above', AT: 'at', AND: 'and', ON: 'on', IN: 'in', CLIMB: 'climb', DESCENT: 'descent', DSNT: 'distant', FNL: 'final', APCH: 'approach', DEP: 'departure', ICE: 'ice', ICG: 'icing', TURB: 'turbulence', 'MOD-OCNL': 'moderate, occasionally', LGT_: 'light', TOPS: 'tops', TOP: 'top', BASES: 'bases', BASE: 'base', OVC: 'overcast', BKN: 'broken', SCT: 'scattered', FEW: 'few', SKC: 'sky clear', CLD: 'cloud', CLDS: 'clouds', IMC: 'in IMC', VMC: 'in VMC', RWY: 'runway', KT: 'knots', KTS: 'knots', LOSS: 'loss', GAIN: 'gain', WND: 'wind', SHR: 'shear', ALT: 'altitude', FL: 'flight level' };

  function altWord(tok) {
    const m = /^(\d{3})-(\d{3})$/.exec(tok);
    if (m) return 'between ' + fmt(Number(m[1]) * 100) + ' and ' + fmt(Number(m[2]) * 100) + ' ft';
    if (/^\d{3}$/.test(tok)) return fmt(Number(tok) * 100) + ' ft';
    if (/^FL\d{3}$/.test(tok)) return fmt(Number(tok.slice(2)) * 100) + ' ft (FL' + tok.slice(2) + ')';
    return null;
  }

  function phraseFrom(str, table) {
    const words = str.split(' ').filter(Boolean).map(tok => altWord(tok) || table[tok] || decodeWxWord(tok) || tok.toLowerCase());
    return words.join(' ');
  }
  function decodeWxWord(tok) { const w = decodeWx(tok); return w ? w.text : null; }

  function decodeLocation(ov) {
    const segs = ov.split(/\s*-\s*/).filter(Boolean);
    const parts = segs.map(seg => {
      seg = seg.trim();
      let m = /^([A-Z]{3,4})(\d{3})(\d{3})$/.exec(seg);
      if (m) return Number(m[3]) + ' NM out on the ' + m[2] + '° radial from ' + m[1];
      m = /^([A-Z]{3,4})(\d{3})(\d{2})$/.exec(seg);
      if (m) return Number(m[3]) + ' NM out on the ' + m[2] + '° radial from ' + m[1];
      m = /^(\d{2,4})([NS])\s*(\d{3,5})([EW])$/.exec(seg);
      if (m) return 'latitude ' + m[1].slice(0, 2) + '°' + (m[1].slice(2) ? m[1].slice(2) + "'" : '') + m[2] + ', longitude ' + m[3].slice(0, 3) + '°' + (m[3].slice(3) ? m[3].slice(3) + "'" : '') + m[4];
      m = /^(\d{1,3})\s*([NESW]{1,3})\s+([A-Z]{3,4})$/.exec(seg);
      if (m) return m[1] + ' NM ' + m[2] + ' of ' + m[3];
      m = /^([A-Z]{3,4})\s+(\d{1,3})\s*([NESW]{1,3})$/.exec(seg);
      if (m) return m[2] + ' NM ' + m[3] + ' of ' + m[1];
      if (/^[A-Z]{3,4}$/.test(seg)) return 'over ' + seg;
      return seg;
    });
    return segs.length > 1 ? 'along a route ' + parts.join(' to ') : parts[0] || ov;
  }

  function pirep(raw) {
    raw = raw.replace(/\s+/g, ' ').trim();
    const f = { station: null, urgent: false, ov: null, tm: null, fl: null, tp: null, sk: null, wx: null, ta: null, wv: null, tb: null, ic: null, rm: null };
    const lines = [];
    const firstSlash = raw.indexOf('/');
    const head = (firstSlash === -1 ? raw : raw.slice(0, firstSlash)).trim().split(' ');
    f.station = head[0];
    const kind = head[1] || 'UA';
    f.urgent = kind === 'UUA';
    lines.push({ raw: f.station, label: 'Station', text: 'nearest weather reporting location to the report: ' + f.station });
    lines.push({ raw: kind, label: 'Type', text: f.urgent ? 'UUA: URGENT pilot report (severe or extreme turbulence, severe icing, low-level wind shear, hail, volcanic ash, or similar)' : 'UA: routine pilot report' });
    const body = firstSlash === -1 ? '' : raw.slice(firstSlash);
    // Split on "/XX" field keys. No \b after the key: "/FL105" and "/FLUNKN" run letters into the value.
    const fields = body.split(/\s*\/(?=(?:OV|TM|FL|TP|SK|WX|TA|WV|TB|IC|RM)(?:\s|\d|$)|FL[A-Z])/).map(s => s.trim()).filter(Boolean);
    fields.forEach(fld => {
      const key = fld.slice(0, 2); const val = fld.slice(2).trim();
      const rawTok = '/' + key + ' ' + val;
      let m;
      switch (key) {
        case 'OV': f.ov = { raw: val, text: decodeLocation(val) }; lines.push({ raw: rawTok, label: 'Location', text: f.ov.text }); break;
        case 'TM': m = /^(\d{2})(\d{2})/.exec(val); f.tm = m ? { hh: Number(m[1]), mm: Number(m[2]) } : null; lines.push({ raw: rawTok, label: 'Time', text: m ? 'reported at ' + hhmm(m[1], m[2]) + ' (UTC)' : 'time ' + val }); break;
        case 'FL':
          m = /^(\d{3})/.exec(val);
          if (m) { f.fl = Number(m[1]) * 100; lines.push({ raw: rawTok, label: 'Altitude', text: 'altitude or flight level: ' + fmt(f.fl) + ' ft MSL' + (val.length > 3 ? ' (' + val.slice(3).trim() + ')' : '') }); }
          else { f.fl = null; lines.push({ raw: rawTok, label: 'Altitude', text: /UNKN?/.test(val) ? 'altitude unknown' : phraseFrom(val, TURB) }); }
          break;
        case 'TP': f.tp = val; lines.push({ raw: rawTok, label: 'Aircraft type', text: 'aircraft type ' + val + (val === 'UNKN' ? ' (unknown)' : '') }); break;
        case 'SK': f.sk = { raw: val, text: skyPhrase(val) }; lines.push({ raw: rawTok, label: 'Sky', text: f.sk.text }); break;
        case 'WX': f.wx = { raw: val, text: wxPhrase(val) }; lines.push({ raw: rawTok, label: 'Weather', text: f.wx.text }); break;
        case 'TA': m = /^(M?)(\d{1,3})/.exec(val); f.ta = m ? (m[1] ? -1 : 1) * Number(m[2]) : null; lines.push({ raw: rawTok, label: 'Temperature', text: m ? 'outside air temperature ' + f.ta + '°C' : 'temperature ' + val }); break;
        case 'WV':
          m = /^(\d{3})\/?(\d{2,3})(KT|KTS)?/.exec(val);
          f.wv = m ? { dir: Number(m[1]), spd: Number(m[2]) } : null;
          lines.push({ raw: rawTok, label: 'Wind', text: m ? 'wind from ' + m[1] + '° at ' + Number(m[2]) + ' knots' : 'wind ' + val }); break;
        case 'TB': f.tb = { raw: val, text: tbPhrase(val) }; lines.push({ raw: rawTok, label: 'Turbulence', text: f.tb.text }); break;
        case 'IC': f.ic = { raw: val, text: icPhrase(val) }; lines.push({ raw: rawTok, label: 'Icing', text: f.ic.text }); break;
        case 'RM': f.rm = { raw: val, text: rmPhrase(val) }; lines.push({ raw: rawTok, label: 'Remarks', text: f.rm.text }); break;
        default: lines.push({ raw: rawTok, label: key, text: val.toLowerCase() });
      }
    });
    return { type: 'PIREP', raw, station: f.station, lines, f };
  }

  function sevWord(s) {
    return { NEG: 'negative (none reported)', SMOOTH: 'smooth', SMTH: 'smooth', LGT: 'light', MOD: 'moderate', SEV: 'severe', EXTRM: 'extreme', 'LGT-MOD': 'light to moderate', 'MOD-SEV': 'moderate to severe', 'SEV-EXTRM': 'severe to extreme', TRACE: 'trace', TRC: 'trace', 'TRACE-LGT': 'trace to light' }[s] || null;
  }

  function tbPhrase(val) {
    const toks = val.split(' ').filter(Boolean);
    if (toks.length === 1 && toks[0] === 'NEG') return 'negative: no turbulence encountered';
    const out = [];
    toks.forEach(t => {
      const sw = sevWord(t);
      if (sw) out.push(sw + (/^(LGT|MOD|SEV|EXTRM|LGT-MOD|MOD-SEV)$/.test(t) ? ' turbulence' : ''));
      else out.push(altWord(t) || TURB[t] || t.toLowerCase());
    });
    return out.join(' ').replace('turbulence chop', 'chop').replace('turbulence clear-air turbulence', 'clear-air turbulence').replace('turbulence continuous', 'turbulence, continuous');
  }

  function icPhrase(val) {
    const toks = val.split(' ').filter(Boolean);
    if (toks.length === 1 && toks[0] === 'NEG') return 'negative: no icing encountered';
    const out = [];
    toks.forEach(t => {
      const sw = sevWord(t);
      if (sw) out.push(sw + ' icing');
      else out.push(altWord(t) || TURB[t] || t.toLowerCase());
    });
    return out.join(' ').replace('icing rime', 'rime icing').replace('icing clear', 'clear icing').replace('icing mixed', 'mixed icing');
  }

  function skyPhrase(val) {
    const toks = val.replace(/-/g, ' ').split(' ').filter(Boolean);
    const out = []; let mode = 'base';
    toks.forEach(t => {
      let m;
      if ((m = /^(FEW|SCT|BKN|OVC)(\d{3})?$/.exec(t))) { out.push(COVER_SHORT[m[1]] + (m[2] ? ' layer, bases ' + fmt(Number(m[2]) * 100) + ' ft' : '')); mode = 'base'; }
      else if (t === 'SKC' || t === 'CLR') out.push('sky clear');
      else if (/^TOPS?$/.test(t)) { out.push('tops'); mode = 'top'; }
      else if (/^BASES?$/.test(t)) { out.push('bases'); mode = 'base'; }
      else if ((m = /^(\d{3})$/.exec(t))) out.push(fmt(Number(m[1]) * 100) + ' ft');
      else if (t === 'UNKN') out.push('unknown');
      else out.push(TURB[t] || t.toLowerCase());
    });
    return out.join(' ').replace(/ft tops/g, 'ft, tops');
  }

  function wxPhrase(val) {
    const toks = val.split(' ').filter(Boolean);
    return toks.map(t => {
      let m;
      if ((m = /^FV(\d+)SM$/.exec(t))) return 'flight visibility ' + Number(m[1]) + ' SM';
      if ((m = /^FV(\d+)$/.exec(t))) return 'flight visibility ' + Number(m[1]) + ' SM';
      if (t === 'FV') return 'flight visibility';
      if ((m = /^(\d+)SM$/.exec(t))) return m[1] + ' statute miles';
      if (t === 'VIS') return 'visibility';
      const w = decodeWx(t); if (w) return w.text;
      return TURB[t] || t.toLowerCase();
    }).join(' ');
  }

  const RM_WORDS = { DURD: 'during descent', DURC: 'during climb', LLWS: 'low-level wind shear', 'AWC-WEB': 'submitted via the Aviation Weather Center website', FNL: 'final', APCH: 'approach', RWY: 'runway', BLO: 'below', ABV: 'above', KT: 'knots', KTS: 'knots', SMOOTH: 'smooth', SMTH: 'smooth', TOPS: 'tops', BASES: 'bases', OVC: 'overcast', BKN: 'broken', SCT: 'scattered', CLR: 'clear', ICE: 'ice', TURB: 'turbulence', CHOP: 'chop', LGT: 'light', MOD: 'moderate', SEV: 'severe', NEG: 'negative', ON: 'on', OFF: 'off', TO: 'to', AT: 'at', FM: 'from', ALT: 'altitude', WND: 'wind', GAIN: 'gain', LOSS: 'loss', DEP: 'departure', TS: 'thunderstorm', CB: 'cumulonimbus', LTG: 'lightning', DSNT: 'distant', VIS: 'visibility', ACFT: 'aircraft', PING: 'pilot-generated (connected aircraft) report', SKYPATH: 'SkyPath sensor report' };
  function rmPhrase(val) {
    return val.split(' ').filter(Boolean).map(t => {
      if (/^Z[A-Z]{2}(WC)?/.test(t)) return t + ' (ARTCC weather coordinator / center)';
      return altWord(t) && /^\d{3}(-\d{3})?$/.test(t) ? altWord(t) : (RM_WORDS[t] || t.toLowerCase());
    }).join(' ');
  }

  function detect(raw) {
    const t = raw.trim();
    if (/^TAF\b/.test(t) || /\b\d{4}\/\d{4}\b.*\b(FM\d{6}|TEMPO|BECMG|PROB\d{2})\b/.test(t) || /^[A-Z]{4} \d{6}Z \d{4}\/\d{4} /.test(t)) return 'TAF';
    if (/\b(UA|UUA) \/OV\b/.test(t) || /\/OV /.test(t)) return 'PIREP';
    return 'METAR';
  }

  window.wxDecode = { detect, metar, taf, pirep, decodeWx, flightCategory, tafPrevailingAt, fmt, ordinal, hhmm, pad2, COVER_SHORT };
})();

/* Etiquetas — converte o TXT (ZPL) de etiquetas do Mercado Livre em PDF.
   Produto: redesenha no tamanho escolhido. Volume: desenha fiel ao ZPL em 10 × 15.
   Bibliotecas (jsPDF 2.5.1 e qrcode-generator 1.4.4) carregadas sob demanda em etiqInit(). */
const EtiquetasZPL = (() => {
  // Etiquetas de PRODUTO: tamanhos que o Mercado Livre libera (mm por etiqueta; cols = colunas no rolo)
  const SIZES = [
    { id: '40x25-1', w: 40, h: 25, cols: 1, nome: '4 × 2,5 cm', desc: '1 coluna' },
    { id: '40x25-2', w: 40, h: 25, cols: 2, nome: '4 × 2,5 cm', desc: '2 colunas' },
    { id: '50x25-1', w: 50, h: 25, cols: 1, nome: '5 × 2,5 cm', desc: '1 coluna' },
    { id: '50x25-2', w: 50, h: 25, cols: 2, nome: '5 × 2,5 cm', desc: '2 colunas' },
    { id: '60x40-1', w: 60, h: 40, cols: 1, nome: '6 × 4 cm',   desc: '1 coluna' },
    { id: '80x50-1', w: 80, h: 50, cols: 1, nome: '8 × 5 cm',   desc: '1 coluna' },
  ];
  // Etiqueta de VOLUME: sempre 10 × 15, desenhada fiel ao ZPL do ML
  const VOLUME = { id: '100x150-vol', w: 100, h: 150, cols: 1, nome: '10 × 15 cm', desc: 'Etiqueta de volume' };
  const COL_GAP = 0;                     // mm entre colunas (o TXT 2 colunas do ML usa 0)
  const DPMM = 8;                        // térmica 203 dpi = 8 pontos por mm
  const VOL_DOTS = { w: 812, h: 1218 };  // área original 4 × 6 pol
  const PT_MM = 0.3528;
  const DOT = 25.4 / 203;

  // ---------- Leitura comum ----------
  function decodeFH(s) {
    if (s.indexOf('_') < 0) return s;
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      const m = s.slice(i, i + 3).match(/^_([0-9A-Fa-f]{2})$/);
      if (m) { bytes.push(parseInt(m[1], 16)); i += 2; }
      else { for (const b of new TextEncoder().encode(s[i])) bytes.push(b); }
    }
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  }
  const splitBlocks = text => String(text).match(/\^XA[\s\S]*?\^XZ/gi) || [];
  const commands = blk => blk.replace(/[\r\n]+/g, '').split('^').slice(1)
    .map(c => ({ code: c.slice(0, 2).toUpperCase(), args: c.slice(2) }));
  function qtyOf(blk) { const m = blk.match(/\^PQ(\d+)/i); return m ? Math.max(1, parseInt(m[1], 10) || 1) : 1; }
  const isVolumeBlock = blk => /\^(GF|GB|BQ)/i.test(blk);

  // Devolve { kind: 'produto' | 'volume' | 'misto' | null, labels: [...] }
  function parse(text) {
    const blks = splitBlocks(text);
    if (!blks.length) return { kind: null, labels: [] };
    const nVol = blks.filter(isVolumeBlock).length;
    if (nVol && nVol < blks.length) return { kind: 'misto', labels: [] };
    if (nVol) {
      const labels = [];
      for (const b of blks) { const l = parseVolume(b); for (let q = qtyOf(b); q > 0; q--) labels.push(l); }
      return { kind: 'volume', labels };
    }
    return { kind: 'produto', labels: parseProducts(blks) };
  }

  // ---------- PRODUTO: extrai código, nome e SKU ----------
  function parseProducts(blks) {
    const out = [];
    for (const blk of blks) {
      const qty = qtyOf(blk);
      let fh = false, isBar = false, cur = null;
      const raw = [];
      for (const { code, args } of commands(blk)) {
        if (code === 'FO' || code === 'FT') { fh = false; isBar = false; }
        else if (code === 'FH') fh = true;
        else if (code[0] === 'B' && code !== 'BY') isBar = true;
        else if (code === 'FD' || code === 'FV') {
          let data = fh ? decodeFH(args) : args;
          data = data.replace(/\s+/g, ' ').trim();
          if (isBar) { cur = { code: data.replace(/^>[:;9]/, ''), texts: [] }; raw.push(cur); }
          else if (data) {
            if (!cur) { cur = { code: '', texts: [] }; raw.push(cur); }
            if (!cur.texts.includes(data)) cur.texts.push(data);
          }
        }
      }
      for (const r of raw) {
        const texts = r.texts.filter(t => t !== r.code);
        let sku = '';
        const info = [], titleParts = [];
        for (const t of texts) {
          const m = t.match(/^SKU\s*:\s*(.*)$/i);
          if (m) sku = m[1].trim();
          else if (/^[^:]{1,24}:\s*\S/.test(t)) info.push(t);
          else titleParts.push(t);
        }
        const label = { kind: 'produto', code: r.code, title: titleParts.join(' '), info, sku };
        for (let q = 0; q < qty; q++) out.push(label);
      }
    }
    return out;
  }

  // ---------- VOLUME: interpreta o ZPL e guarda a lista de desenho (em pontos) ----------
  function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  // ^GF em ASCII hex compactado (o formato que o ML usa)
  function decodeGF(args) {
    const m = args.match(/^([ABC]?),(\d+),(\d+),(\d+),([\s\S]*)$/);
    if (!m || (m[1] && m[1] !== 'A')) return null;
    const total = +m[2], bpr = +m[4], data = m[5];
    if (!bpr || /^:(Z64|B64):/.test(data)) return null;
    const rowLen = bpr * 2, rows = [];
    let row = '', cnt = 0;
    const end = () => { rows.push(row); row = ''; };
    for (const ch of data) {
      const c = ch.charCodeAt(0);
      if (c >= 71 && c <= 89) { cnt += c - 70; continue; }           // G..Y = 1..19
      if (c >= 103 && c <= 122) { cnt += (c - 102) * 20; continue; } // g..z = 20..400
      if (/[0-9A-Fa-f]/.test(ch)) { let k = cnt || 1; cnt = 0; while (k--) { row += ch; if (row.length === rowLen) end(); } continue; }
      if (ch === ',') { cnt = 0; row = row.padEnd(rowLen, '0'); end(); continue; }
      if (ch === '!') { cnt = 0; row = row.padEnd(rowLen, 'F'); end(); continue; }
      if (ch === ':') { cnt = 0; if (row.length) { row = row.padEnd(rowLen, '0'); end(); } rows.push(rows.length ? rows[rows.length - 1] : '0'.repeat(rowLen)); continue; }
    }
    if (row.length) { row = row.padEnd(rowLen, '0'); end(); }
    const h = Math.min(rows.length, Math.ceil(total / bpr)), w = bpr * 8;
    const bits = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const r = rows[y];
      for (let b = 0; b < rowLen; b++) {
        const v = parseInt(r[b], 16);
        for (let k = 0; k < 4; k++) bits[y * w + b * 4 + k] = (v >> (3 - k)) & 1;
      }
    }
    return { w, h, bits, key: 'gf' + hash(args) };
  }

  function parseVolume(blk) {
    const ops = [];
    let lhx = 0, lhy = 0, x = 0, y = 0, ft = false;
    let font = null, defFont = { h: 30, w: 30 }, fb = null, rev = false, fh = false, bar = null;
    let by = { w: 2, r: 3, h: 10 };
    const reset = () => { font = null; fb = null; rev = false; fh = false; bar = null; };
    for (const { code, args } of commands(blk)) {
      const a = args.split(',');
      const n = (i, d) => { const v = parseFloat(a[i]); return isNaN(v) ? d : v; };
      const s = i => (a[i] || '').trim().toUpperCase();
      switch (code) {
        case 'LH': lhx = n(0, 0); lhy = n(1, 0); break;
        case 'FO': case 'FT': x = n(0, 0) + lhx; y = n(1, 0) + lhy; ft = code === 'FT'; break;
        case 'BY': by = { w: n(0, by.w), r: n(1, by.r), h: n(2, by.h) }; break;
        case 'CF': defFont = { h: n(1, defFont.h), w: n(2, n(1, defFont.h)) }; break;
        case 'FB': fb = { w: n(0, 0), lines: Math.max(1, n(1, 1)), sp: n(2, 0), j: s(3) || 'L' }; break;
        case 'FR': rev = true; break;
        case 'FH': fh = true; break;
        case 'BC': bar = { k: 'c128', h: n(1, by.h), interp: s(2) !== 'N', mode: s(5) || 'N' }; break;
        case 'BQ': bar = { k: 'qr', mag: n(2, 2) }; break;
        case 'GB': {
          const t = Math.max(1, n(2, 1));
          ops.push({ t: 'box', x, y, w: Math.max(n(0, t), t), h: Math.max(n(1, t), t), th: t, white: s(3) === 'W' });
          reset(); break;
        }
        case 'GF': { const g = decodeGF(args); if (g) ops.push({ t: 'img', x, y, ...g }); reset(); break; }
        case 'FS': reset(); break;
        case 'FD': case 'FV': {
          const data = fh ? decodeFH(args) : args;
          if (bar && bar.k === 'c128') {
            const enc = c128Zpl(data, bar.mode);
            ops.push({ t: 'bars', x, y, widths: c128Widths(enc.vals), mod: by.w, h: bar.h, text: bar.interp ? enc.text : '' });
          } else if (bar && bar.k === 'qr') {
            const m = data.match(/^([HQML])([AM]),([\s\S]*)$/);
            let ecc = 'M', d = data;
            if (m) { ecc = m[1]; d = m[3]; if (m[2] === 'M') d = /^B\d{4}/.test(d) ? d.slice(5) : d.slice(1); }
            ops.push({ t: 'qr', x, y, mag: bar.mag, ecc, data: d });
          } else if (data.length) {
            const f = font || defFont;
            ops.push({ t: 'text', x, y, ft, fh: f.h, fw: f.w || f.h, fb, rev, s: data });
          }
          break;
        }
        default:
          if (/^A[0-9A-Z]$/.test(code)) { const hh = n(1, defFont.h); font = { h: hh, w: n(2, hh) }; }
      }
    }
    // Metadados para o resumo
    const texts = ops.filter(o => o.t === 'text');
    const envT = texts.find(o => /Envio\s*:/i.test(o.s));
    const envio = envT ? envT.s.replace(/^.*Envio\s*:\s*/i, '').trim() : '';
    const big = texts.reduce((m, o) => (!m || o.fh > m.fh ? o : m), null);
    // Moldura: 4 × 6 pol, ampliada só se um desenho (caixa, imagem, código) passar da borda.
    // Texto não conta: a caixa ^FB do ML costuma passar da borda sem ter nada escrito lá.
    let fw = VOL_DOTS.w, fhh = VOL_DOTS.h;
    for (const o of ops) {
      if (o.t === 'text' || o.t === 'qr') continue;
      const r = o.t === 'bars' ? o.x + o.widths.reduce((p, c) => p + c, 0) * o.mod : o.x + (o.w || 0);
      fw = Math.max(fw, r); fhh = Math.max(fhh, o.y + (o.h || 0));
    }
    return { kind: 'volume', ops, envio, destino: big ? big.s : '', frame: { w: fw, h: fhh } };
  }

  // ---------- Code 128 ----------
  const PAT = '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'.split(' ');
  function checksum(vals) { let sum = vals[0]; for (let k = 1; k < vals.length; k++) sum += vals[k] * k; return vals.concat(sum % 103, 106); }

  // Automático (B + C), usado nas etiquetas de produto redesenhadas
  function c128Values(data) {
    const s = String(data);
    const isD = i => i < s.length && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57;
    const run = i => { let j = i; while (isD(j)) j++; return j - i; };
    const vals = [];
    let set, i = 0;
    const r0 = run(0);
    if (r0 >= 4 || (r0 === 2 && s.length === 2)) { set = 'C'; vals.push(105); } else { set = 'B'; vals.push(104); }
    while (i < s.length) {
      if (set === 'C') {
        if (run(i) >= 2) { vals.push(parseInt(s.substr(i, 2), 10)); i += 2; } else { vals.push(100); set = 'B'; }
      } else {
        const r = run(i);
        if (r >= 6 || (r >= 4 && i + r === s.length)) {
          if (r % 2 === 1) { vals.push(s.charCodeAt(i) - 32); i++; }
          vals.push(99); set = 'C';
        } else {
          let cc = s.charCodeAt(i); if (cc < 32 || cc > 126) cc = 63;
          vals.push(cc - 32); i++;
        }
      }
    }
    return checksum(vals);
  }
  // Fiel ao ZPL (^BC modo N respeita >: >; >9 >5 >6 >7), usado na etiqueta de volume
  function c128Zpl(data, mode) {
    const plain = data.replace(/>[:;9567]/g, '').replace(/>0/g, '>');
    if (mode === 'A') return { vals: c128Values(plain), text: plain };
    let s = data, set = 'B';
    if (s[0] === '>' && ':;9'.includes(s[1])) { set = s[1] === ':' ? 'B' : s[1] === ';' ? 'C' : 'A'; s = s.slice(2); }
    const vals = [set === 'A' ? 103 : set === 'B' ? 104 : 105];
    for (let i = 0; i < s.length;) {
      if (s[i] === '>' && i + 1 < s.length) {
        const nx = s[i + 1], to = { '5': 'C', '6': 'B', '7': 'A' }[nx];
        if (to) { if (to !== set) { vals.push(to === 'C' ? 99 : to === 'B' ? 100 : 101); set = to; } i += 2; continue; }
        if (nx === '0') { vals.push(set === 'C' ? 0 : 30); i += 2; continue; }
      }
      if (set === 'C') { const p = s.substr(i, 2); if (/^\d\d$/.test(p)) vals.push(+p); i += 2; continue; }
      let cc = s.charCodeAt(i);
      if (set === 'A') vals.push(cc < 32 ? cc + 64 : cc - 32);
      else { if (cc < 32 || cc > 126) cc = 63; vals.push(cc - 32); }
      i++;
    }
    return { vals: checksum(vals), text: plain };
  }
  // Larguras em módulos, alternando barra/espaço, começando por barra
  function c128Widths(vals) { const w = []; for (const v of vals) for (const ch of PAT[v]) w.push(+ch); return w; }

  // ---------- QR ----------
  const qrCache = new Map();
  function qrMatrix(data, ecc) {
    const Q = globalThis.qrcode;
    if (!Q) return null;
    const key = ecc + '|' + data;
    if (qrCache.has(key)) return qrCache.get(key);
    Q.stringToBytes = Q.stringToBytesFuncs['UTF-8'];
    const q = Q(0, ecc); q.addData(data, 'Byte'); q.make();
    const n = q.getModuleCount(), m = [];
    for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(q.isDark(r, c)); m.push(row); }
    qrCache.set(key, m);
    return m;
  }

  // ---------- Medidas de texto (jsPDF, iguais na prévia e no PDF) ----------
  let _measurer = null;
  function getJsPDF() { return (globalThis.jspdf && globalThis.jspdf.jsPDF) || null; }
  function measure(text, em, bold) {
    const J = getJsPDF();
    if (!_measurer) _measurer = new J({ unit: 'mm', format: [50, 50] });
    _measurer.setFont('helvetica', bold ? 'bold' : 'normal');
    return _measurer.getStringUnitWidth(text) * em;
  }
  function wrap(text, em, bold, maxW, hs) {
    hs = hs || 1;
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (!cur || measure(t, em, bold) * hs <= maxW) cur = t;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function ellipsize(line, em, bold, maxW) {
    let t = line;
    while (t.length > 1 && measure(t + '…', em, bold) > maxW) t = t.slice(0, -1);
    return t.trimEnd() + '…';
  }

  // ---------- Layout PRODUTO (mm) ----------
  function build(label, W, H, u) {
    const pad = Math.max(1, Math.min(W, H) * 0.05);
    const aw = W - pad * 2;
    const maxTitle = H >= 40 ? 3 : 2;
    const barH = 6.5 * u, codeEm = 2.6 * u, infoEm = 2.2 * u, gap = 0.7 * u;
    const ops = [];
    let y = 0;
    if (label.code) {
      const widths = c128Widths(c128Values(label.code));
      const modules = widths.reduce((a, b) => a + b, 0);
      let mod = Math.floor((aw * 0.96 / modules) / DOT) * DOT; // múltiplo do ponto da impressora
      mod = Math.min(mod, 4 * DOT);
      if (mod < DOT) mod = aw * 0.96 / modules;
      const bw = modules * mod;
      let x = pad + (aw - bw) / 2;
      widths.forEach((m, k) => { if (k % 2 === 0) ops.push({ t: 'rect', x, y, w: m * mod, h: barH }); x += m * mod; });
      y += barH + Math.max(0.6, gap * 0.55);
      ops.push({ t: 'text', x: pad + aw / 2, y: y + codeEm * 0.74, em: codeEm, bold: true, align: 'center', s: label.code });
      y += codeEm * 0.74 + gap;
    }
    if (label.title) {
      let em = 2.2 * u, lines = wrap(label.title, em, false, aw);
      while (lines.length > maxTitle && em > 1.55 * u) { em *= 0.94; lines = wrap(label.title, em, false, aw); }
      if (lines.length > maxTitle) { lines = lines.slice(0, maxTitle); lines[maxTitle - 1] = ellipsize(lines[maxTitle - 1], em, false, aw); }
      for (const ln of lines) { ops.push({ t: 'text', x: pad, y: y + em * 0.74, em, bold: false, align: 'left', s: ln }); y += em * 1.12; }
      y += gap * 0.35;
    }
    const extra = [...label.info];
    if (label.sku) extra.push('SKU: ' + label.sku);
    for (const ln of extra) {
      let em = infoEm;
      while (measure(ln, em, true) > aw && em > 1.2 * u) em *= 0.94;
      ops.push({ t: 'text', x: pad, y: y + em * 0.74, em, bold: true, align: 'left', s: ln });
      y += em * 1.12;
    }
    return { ops, height: y, pad };
  }
  function layoutProduct(label, W, H, scalePct) {
    const avail = H - 2 * Math.max(1, Math.min(W, H) * 0.05);
    let lo = 0.2, hi = 2.0;
    if (build(label, W, H, hi).height <= avail) lo = hi;
    else for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (build(label, W, H, m).height <= avail) lo = m; else hi = m; }
    const u = lo * Math.max(0.3, Math.min(1, (scalePct || 100) / 100));
    const r = build(label, W, H, u);
    const dy = r.pad + (avail - r.height) / 2;
    return r.ops.map(o => ({ ...o, y: o.y + dy }));
  }

  // ---------- Desenho VOLUME (pontos) num "backend" (canvas ou PDF) ----------
  const ZPL_HS = 0.82;   // fonte 0 do ZPL é mais estreita que a Helvetica Bold
  const ZPL_ASC = 0.78;  // linha de base em relação ao topo da célula
  function textLines(o) {
    const hs = ZPL_HS * (o.fw / o.fh);
    const width = t => measure(t, o.fh, true) * hs;
    const out = [];
    if (o.fb && o.fb.w > 0) {
      let lines = [];
      for (const para of o.s.split('\\&')) { const w = wrap(para, o.fh, true, o.fb.w, hs); lines.push(...(w.length ? w : [''])); }
      if (lines.length > o.fb.lines) lines = lines.slice(0, o.fb.lines - 1).concat(lines.slice(o.fb.lines - 1).join(' '));
      lines.forEach((ln, i) => {
        let lhs = hs, lw = width(ln);
        if (lw > o.fb.w) { lhs = hs * o.fb.w / lw; lw = o.fb.w; }
        const x = o.fb.j === 'C' ? o.x + (o.fb.w - lw) / 2 : o.fb.j === 'R' ? o.x + o.fb.w - lw : o.x;
        out.push({ s: ln, x, base: o.y + i * (o.fh + o.fb.sp) + o.fh * ZPL_ASC, w: lw, hs: lhs });
      });
    } else out.push({ s: o.s, x: o.x, base: o.y + o.fh * ZPL_ASC, w: width(o.s), hs });
    if (o.ft) for (const l of out) l.base -= o.fh * ZPL_ASC;
    return out;
  }
  function renderVolume(label, be) {
    const black = [];
    const inBlack = (x, y) => black.some(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    for (const o of label.ops) {
      if (o.t === 'box') {
        const col = o.white ? 'W' : 'B';
        if (o.th * 2 >= Math.min(o.w, o.h)) { be.rect(o.x, o.y, o.w, o.h, col); if (col === 'B') black.push(o); }
        else {
          be.rect(o.x, o.y, o.w, o.th, col); be.rect(o.x, o.y + o.h - o.th, o.w, o.th, col);
          be.rect(o.x, o.y, o.th, o.h, col); be.rect(o.x + o.w - o.th, o.y, o.th, o.h, col);
        }
      } else if (o.t === 'img') be.image(o);
      else if (o.t === 'bars') {
        let x = o.x;
        o.widths.forEach((m, i) => { if (i % 2 === 0) be.rect(x, o.y, m * o.mod, o.h, 'B'); x += m * o.mod; });
        if (o.text) {
          const fh = Math.max(18, o.mod * 10), hs = ZPL_HS, tw = measure(o.text, fh, true) * hs;
          be.text(o.text, o.x + (x - o.x - tw) / 2, o.y + o.h + 4 + fh * ZPL_ASC, fh, hs, 'B');
        }
      } else if (o.t === 'qr') {
        const mtx = qrMatrix(o.data, o.ecc);
        if (!mtx) continue;
        mtx.forEach((row, r) => {
          for (let c = 0; c < row.length;) {
            if (!row[c]) { c++; continue; }
            let e = c; while (e < row.length && row[e]) e++;
            be.rect(o.x + c * o.mag, o.y + r * o.mag, (e - c) * o.mag, o.mag, 'B');
            c = e;
          }
        });
      } else if (o.t === 'text') {
        for (const l of textLines(o)) {
          const col = o.rev && inBlack(l.x + l.w / 2, l.base - o.fh * 0.35) ? 'W' : 'B';
          be.text(l.s, l.x, l.base, o.fh, l.hs, col);
        }
      }
    }
  }
  function gfCanvas(o) {
    if (o._cv) return o._cv;
    const cv = document.createElement('canvas'); cv.width = o.w; cv.height = o.h;
    const cx = cv.getContext('2d'), img = cx.createImageData(o.w, o.h);
    for (let i = 0; i < o.bits.length; i++) if (o.bits[i]) img.data[i * 4 + 3] = 255;
    cx.putImageData(img, 0, 0);
    return (o._cv = cv);
  }
  function canvasBackend(ctx, k, ox, oy) {
    return {
      rect(x, y, w, h, col) { ctx.fillStyle = col === 'W' ? '#fff' : '#000'; ctx.fillRect(ox + x * k, oy + y * k, w * k, h * k); },
      text(s, x, base, fh, hs, col) {
        ctx.save(); ctx.fillStyle = col === 'W' ? '#fff' : '#000';
        ctx.font = '700 ' + (fh * k) + 'px Helvetica, Arial, sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.translate(ox + x * k, oy + base * k); ctx.scale(hs, 1); ctx.fillText(s, 0, 0); ctx.restore();
      },
      image(o) { ctx.imageSmoothingEnabled = false; ctx.drawImage(gfCanvas(o), ox + o.x * k, oy + o.y * k, o.w * k, o.h * k); ctx.imageSmoothingEnabled = true; },
    };
  }
  function pdfBackend(doc, k, ox, oy) {
    return {
      rect(x, y, w, h, col) { const v = col === 'W' ? 255 : 0; doc.setFillColor(v, v, v); doc.rect(ox + x * k, oy + y * k, w * k, h * k, 'F'); },
      text(s, x, base, fh, hs, col) {
        const v = col === 'W' ? 255 : 0; doc.setTextColor(v, v, v);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(fh * k / PT_MM);
        doc.text(s, ox + x * k, oy + base * k, { baseline: 'alphabetic', horizontalScale: hs });
      },
      image(o) {
        if (!o._png) o._png = gfCanvas(o).toDataURL('image/png');
        doc.addImage(o._png, 'PNG', ox + o.x * k, oy + o.y * k, o.w * k, o.h * k, o.key, 'FAST');
      },
    };
  }
  // Encaixa a etiqueta de volume na folha 10 × 15: mm por ponto e deslocamento
  function volumeFit(label, scalePct) {
    const f = label.frame;
    const fit = Math.min(VOLUME.w / (f.w / DPMM), VOLUME.h / (f.h / DPMM)) * Math.max(0.3, Math.min(1, (scalePct || 100) / 100));
    const k = fit / DPMM;
    return { k, ox: (VOLUME.w - f.w * k) / 2, oy: (VOLUME.h - f.h * k) / 2 };
  }

  // ---------- Agrupamento e folhas ----------
  function group(labels) {
    const map = new Map();
    for (const l of labels) {
      const k = l.kind === 'volume' ? l.envio.split('/')[0] + '|' + l.destino : l.code + '|' + l.sku + '|' + l.title;
      if (!map.has(k)) map.set(k, l.kind === 'volume' ? { envio: l.envio.split('/')[0], destino: l.destino, qty: 0 } : { ...l, qty: 0 });
      map.get(k).qty++;
    }
    return [...map.values()];
  }
  function sheets(labels, size) {
    const out = [];
    for (let i = 0; i < labels.length; i += size.cols) out.push(labels.slice(i, i + size.cols));
    return out;
  }
  function pageSize(size) { return { w: size.w * size.cols + COL_GAP * (size.cols - 1), h: size.h }; }

  // ---------- Saídas ----------
  function buildPDF(labels, size, scalePct) {
    const J = getJsPDF();
    if (!J) throw new Error('jsPDF não carregou');
    const pg = pageSize(size);
    const orient = pg.w > pg.h ? 'landscape' : 'portrait';
    const doc = new J({ unit: 'mm', format: [pg.w, pg.h], orientation: orient, compress: true });
    const cache = new Map();
    sheets(labels, size).forEach((sheet, si) => {
      if (si > 0) doc.addPage([pg.w, pg.h], orient);
      sheet.forEach((label, ci) => {
        if (label.kind === 'volume') {
          const f = volumeFit(label, scalePct);
          renderVolume(label, pdfBackend(doc, f.k, f.ox, f.oy));
          return;
        }
        let ops = cache.get(label);
        if (!ops) { ops = layoutProduct(label, size.w, size.h, scalePct); cache.set(label, ops); }
        const ox = ci * (size.w + COL_GAP);
        doc.setFillColor(0, 0, 0); doc.setTextColor(0, 0, 0);
        for (const o of ops) {
          if (o.t === 'rect') doc.rect(ox + o.x, o.y, o.w, o.h, 'F');
          else {
            doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
            doc.setFontSize(o.em / PT_MM);
            doc.text(o.s, ox + o.x, o.y, { align: o.align, baseline: 'alphabetic' });
          }
        }
      });
    });
    return doc;
  }

  function drawSheet(canvas, sheet, size, scalePct, pxPerMm) {
    const pg = pageSize(size);
    const dpr = (globalThis.devicePixelRatio || 1);
    const k = pxPerMm * dpr;
    canvas.width = Math.round(pg.w * k); canvas.height = Math.round(pg.h * k);
    canvas.style.width = Math.round(pg.w * pxPerMm) + 'px';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    sheet.forEach((label, ci) => {
      if (label.kind === 'volume') {
        const f = volumeFit(label, scalePct);
        renderVolume(label, canvasBackend(ctx, f.k * k, f.ox * k, f.oy * k));
        return;
      }
      const ox = ci * (size.w + COL_GAP);
      for (const o of layoutProduct(label, size.w, size.h, scalePct)) {
        if (o.t === 'rect') ctx.fillRect((ox + o.x) * k, o.y * k, Math.max(1, o.w * k), o.h * k);
        else {
          ctx.font = (o.bold ? '700 ' : '400 ') + (o.em * k) + 'px Helvetica, Arial, sans-serif';
          ctx.textAlign = o.align; ctx.textBaseline = 'alphabetic';
          ctx.fillText(o.s, (ox + o.x) * k, o.y * k);
        }
      }
    });
    if (size.cols > 1) { // linha guia entre colunas (só na prévia)
      ctx.strokeStyle = '#d0d0d0'; ctx.setLineDash([4 * dpr, 4 * dpr]);
      for (let c = 1; c < size.cols; c++) { const x = (c * size.w) * k; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
    }
  }

  return { SIZES, VOLUME, parse, group, sheets, pageSize, buildPDF, drawSheet, hasQR: () => !!globalThis.qrcode };
})();

/* ==========================================================================
   UI — página "Etiquetas" (#page-etiq). Abre com showPage('etiq') → etiqInit().
   As bibliotecas (jsPDF e QR) só são baixadas quando a página é aberta.
   ========================================================================== */
(function () {
  var LIBS = [
    ['jspdf', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'],
    ['qrcode', 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'],
  ];
  var _libsP = null;
  function loadLibs() {
    if (_libsP) return _libsP;
    _libsP = Promise.all(LIBS.map(function (l) {
      if (globalThis[l[0]]) return Promise.resolve();
      return new Promise(function (ok, fail) {
        var s = document.createElement('script');
        s.src = l[1]; s.async = true;
        s.onload = function () { ok(); };
        s.onerror = function () { fail(new Error(l[0])); };
        document.head.appendChild(s);
      });
    })).catch(function (e) { _libsP = null; throw e; });
    return _libsP;
  }

  var $ = function (id) { return document.getElementById(id); };
  var Z = EtiquetasZPL;
  var st = { labels: [], kind: null, name: '', size: Z.SIZES[1], scale: 100, page: 0, ready: false, wired: false };
  var productSize = st.size;

  function pref(k, def) {
    try { if (typeof getCached === 'function') { var v = getCached('realecom_etiq_' + k, 'null'); return v == null ? def : v; } } catch (e) {}
    try { var r = localStorage.getItem('realecom_etiq_' + k); return r == null ? def : JSON.parse(r); } catch (e) { return def; }
  }
  function setPref(k, v) {
    try { if (typeof setCached === 'function') { setCached('realecom_etiq_' + k, v); return; } } catch (e) {}
    try { localStorage.setItem('realecom_etiq_' + k, JSON.stringify(v)); } catch (e) {}
  }
  function showErr(msg) { var e = $('zpl-err'); if (!e) return; e.textContent = msg || ''; e.classList.toggle('zpl-hide', !msg); }

  function wire() {
    if (st.wired) return;
    st.wired = true;
    var sid = pref('size', null), f = Z.SIZES.find(function (x) { return x.id === sid; });
    if (f) st.size = productSize = f;
    var sc = parseInt(pref('scale', 100), 10); if (sc >= 60 && sc <= 100) st.scale = sc;

    var sizesEl = $('zpl-sizes');
    if (sizesEl) {
      Z.SIZES.concat(Z.VOLUME).forEach(function (sz) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'zpl-size'; b.dataset.id = sz.id;
        var ik = Math.min(1 / 3.2, 26 / sz.h), iw = Math.round(sz.w * ik), ih = Math.round(sz.h * ik), ico = '';
        for (var c = 0; c < sz.cols; c++) ico += '<i style="width:' + (sz.cols > 1 ? Math.round(iw * .8) : iw) + 'px;height:' + ih + 'px"></i>';
        b.innerHTML = '<span class="zpl-ico">' + ico + '</span><span><b>' + sz.nome + '</b><small>' + sz.desc + '</small></span>';
        b.addEventListener('click', function () {
          if (sz === Z.VOLUME) return;
          st.size = productSize = sz; st.page = 0; setPref('size', sz.id); render();
        });
        sizesEl.appendChild(b);
      });
    }
    var scaleEl = $('zpl-scale');
    if (scaleEl) { scaleEl.value = st.scale; scaleEl.addEventListener('input', function () { st.scale = +scaleEl.value; setPref('scale', st.scale); render(); }); }

    // Seleção de arquivo: botão explícito chama input.click() (funciona em tablet/iPad).
    var fileEl = $('zpl-file'), drop = $('zpl-drop');
    if (fileEl) fileEl.addEventListener('change', function () { var fs = fileEl.files; load(fs).then(function () { fileEl.value = ''; }); });
    if (drop && fileEl) {
      drop.addEventListener('click', function () { fileEl.click(); });
      drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileEl.click(); } });
      ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
      drop.addEventListener('drop', function (e) { load(e.dataTransfer.files); });
    }
    var clr = $('zpl-clear');
    if (clr) clr.addEventListener('click', function () { st.labels = []; st.kind = null; st.name = ''; st.size = productSize; showErr(''); render(); });

    var pv = $('zpl-prev'); if (pv) pv.addEventListener('click', function () { st.page--; render(); });
    var nx = $('zpl-next'); if (nx) nx.addEventListener('click', function () { st.page++; render(); });
    var gen = $('zpl-gen'); if (gen) gen.addEventListener('click', gerar);
    var rt; window.addEventListener('resize', function () { if (!st.ready) return; clearTimeout(rt); rt = setTimeout(render, 120); });
  }

  function readText(f) {
    if (f.text) return f.text();
    return new Promise(function (ok, fail) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = fail; r.readAsText(f); });
  }

  async function load(files) {
    if (!files || !files.length) return;
    try { await loadLibs(); st.ready = true; }
    catch (e) { showErr('Não foi possível carregar o gerador de PDF. Verifique a internet e abra a página de novo.'); return; }
    var labels = [], names = [], kinds = new Set();
    for (var i = 0; i < files.length; i++) {
      var r = Z.parse(await readText(files[i]));
      if (r.kind) kinds.add(r.kind);
      labels = labels.concat(r.labels);
      names.push(files[i].name);
    }
    if (kinds.has('misto') || kinds.size > 1) { showErr('Envie as etiquetas de produto e as de volume separadas, um tipo de cada vez.'); return; }
    if (!labels.length) { showErr('Não encontrei etiquetas nesse arquivo. Confira se é o TXT de etiquetas baixado do Mercado Livre.'); return; }
    var kind = Array.from(kinds)[0];
    showErr('');
    st.labels = labels; st.kind = kind; st.name = names.join(', '); st.page = 0;
    st.size = kind === 'volume' ? Z.VOLUME : productSize;
    render();
  }

  var SAMPLE = { kind: 'produto', code: 'ABCD12345', title: 'Nome do produto como aparece no anúncio do Mercado Livre', info: [], sku: 'SKU001' };

  function setTxt(id, v) { var el = $(id); if (el) el.textContent = v; }
  function render() {
    var has = st.labels.length > 0, vol = st.kind === 'volume';
    var labels = has ? st.labels : [SAMPLE, SAMPLE];
    document.querySelectorAll('#zpl-tool .zpl-size').forEach(function (b) {
      var isVolCard = b.dataset.id === Z.VOLUME.id;
      b.classList.toggle('zpl-hide', vol ? !isVolCard : isVolCard);
      b.classList.toggle('on', b.dataset.id === st.size.id);
    });
    setTxt('zpl-size-note', vol ? 'Etiqueta de volume sai sempre em 10 × 15 cm, com o mesmo desenho do Mercado Livre.' : 'Etiqueta de volume é reconhecida sozinha pelo arquivo e sai em 10 × 15 cm.');
    setTxt('zpl-scale-out', st.scale + '%');
    var fr = $('zpl-file-row'); if (fr) fr.classList.toggle('zpl-hide', !has);
    setTxt('zpl-file-name', st.name);
    setTxt('zpl-kind', vol ? 'Etiqueta de volume' : 'Etiqueta de produto');
    var drop = $('zpl-drop'); if (drop) drop.classList.toggle('zpl-hide', has);

    var sheets = Z.sheets(labels, st.size);
    var sm = $('zpl-summary'); if (sm) sm.classList.toggle('zpl-hide', !has);
    if (has) {
      var groups = Z.group(st.labels);
      setTxt('zpl-total', st.labels.length.toLocaleString('pt-BR'));
      setTxt('zpl-groups-lbl', vol ? 'Envios' : 'Produtos diferentes');
      setTxt('zpl-prods', groups.length);
      setTxt('zpl-sheets', sheets.length.toLocaleString('pt-BR'));
      var th = $('zpl-thead');
      if (th) th.innerHTML = vol ? '<th>Envio</th><th>Destino</th><th class="n">Volumes</th>' : '<th>Código</th><th>SKU</th><th>Produto</th><th class="n">Qtd</th>';
      var tb = $('zpl-tbody');
      if (tb) {
        tb.innerHTML = '';
        groups.forEach(function (g) {
          var tr = document.createElement('tr');
          var cells = vol ? [g.envio || '—', g.destino || '—'] : [g.code || '—', g.sku || '—', g.title || '—'];
          cells.forEach(function (v) { var td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
          var td = document.createElement('td'); td.className = 'n'; td.textContent = g.qty; tr.appendChild(td);
          tb.appendChild(tr);
        });
      }
    }

    st.page = Math.max(0, Math.min(st.page, sheets.length - 1));
    var cv = $('zpl-canvas');
    if (cv && st.ready) {
      var pg = Z.pageSize(st.size);
      var box = cv.parentElement ? cv.parentElement.clientWidth - 40 : 600;
      var maxH = vol ? 560 : 260;
      var pxPerMm = Math.max(2, Math.min(9, box / pg.w, maxH / pg.h));
      try { Z.drawSheet(cv, sheets[st.page], st.size, st.scale, pxPerMm); } catch (e) { console.error(e); }
    }
    var nav = $('zpl-nav'); if (nav) nav.classList.toggle('zpl-hide', !has || sheets.length < 2);
    setTxt('zpl-page', 'Folha ' + (st.page + 1).toLocaleString('pt-BR') + ' de ' + sheets.length.toLocaleString('pt-BR'));
    var pv = $('zpl-prev'); if (pv) pv.disabled = st.page <= 0;
    var nx = $('zpl-next'); if (nx) nx.disabled = st.page >= sheets.length - 1;
    var gen = $('zpl-gen'); if (gen) gen.disabled = !has;
  }

  function gerar() {
    var gen = $('zpl-gen');
    if (!st.labels.length || !gen) return;
    gen.disabled = true;
    setTimeout(function () {
      try {
        var doc = Z.buildPDF(st.labels, st.size, st.scale);
        var base = (st.name.split(',')[0] || 'etiquetas').replace(/\.(txt|zpl)$/i, '').replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        doc.save(base + '_' + (st.kind === 'volume' ? '10x15' : st.size.id) + '.pdf');
        if (typeof registrarAtividade === 'function') { try { registrarAtividade('etiq_pdf_' + st.kind); } catch (e) {} }
      } catch (e) { showErr('Não foi possível gerar o PDF: ' + e.message); }
      gen.disabled = false;
    }, 30);
  }

  window.etiqInit = function () {
    wire();
    render();
    loadLibs().then(function () { st.ready = true; render(); })
      .catch(function () { showErr('Não foi possível carregar o gerador de PDF. Verifique a internet e abra a página de novo.'); });
  };
})();

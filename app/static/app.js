const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const cropCanvas = $('#cropCanvas');
const ctx = cropCanvas.getContext('2d');

const state = {
  step: 1,
  file: null,
  image: null,
  imgRect: null,
  crop: null,
  drag: { active: false, mode: 'none', offset: { x: 0, y: 0 }, anchor: null, pointerId: null },
  result: null,
  imageBlob: null,
  imageUrl: null,
  csvBlob: null,
  csvUrl: null,
};

function boardInfo() {
  const base = clampInt($('#boardBase').value, 5, 80, 29);
  const boardCols = clampInt($('#boardCols').value, 1, 8, 2);
  const boardRows = clampInt($('#boardRows').value, 1, 8, 2);
  return {
    base,
    boardCols,
    boardRows,
    outCols: base * boardCols,
    outRows: base * boardRows,
  };
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { detail: text || '请求失败' }; }
  if (!res.ok) throw new Error(data.detail || '请求失败');
  return data;
}

function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function setStep(step) {
  if (step === 2 && !state.image) {
    toast('请先上传图片');
    return;
  }
  if (step === 3 && !state.result) {
    toast('请先生成图纸');
    return;
  }
  state.step = step;
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === `step${step}`));
  $$('.step-pill').forEach(btn => btn.classList.toggle('active', Number(btn.dataset.step) === step));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (step === 2) setTimeout(drawCropCanvas, 50);
}

$$('.step-pill').forEach(btn => btn.addEventListener('click', () => setStep(Number(btn.dataset.step))));
$$('[data-back]').forEach(btn => btn.addEventListener('click', () => setStep(Number(btn.dataset.back))));
$('#toCropBtn').addEventListener('click', () => setStep(2));
$('#newImageBtn').addEventListener('click', () => setStep(1));

function updateSizeText() {
  const b = boardInfo();
  const text = `${b.outCols} × ${b.outRows}`;
  $('#sizeText').textContent = text;
  $('#cropSummary').textContent = text;
  $('#beadCount').textContent = String(b.outCols * b.outRows);
  $('#boardBase').value = b.base;
  $('#boardCols').value = b.boardCols;
  $('#boardRows').value = b.boardRows;
  if (state.image) {
    computeImageRect();
    initCropFromScale();
    drawCropCanvas();
  }
}

['boardBase', 'boardCols', 'boardRows'].forEach(id => {
  $(`#${id}`).addEventListener('input', () => {
    $$('.preset').forEach(p => p.classList.remove('active'));
    updateSizeText();
  });
});

$('#cropScale').addEventListener('input', () => {
  if (!state.image) return;
  initCropFromScale();
  drawCropCanvas();
});

$$('.preset').forEach(btn => {
  btn.addEventListener('click', () => {
    $('#boardBase').value = btn.dataset.base;
    $('#boardCols').value = btn.dataset.cols;
    $('#boardRows').value = btn.dataset.rows;
    $$('.preset').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    updateSizeText();
  });
});

$('#imageInput').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('请上传图片文件');
    return;
  }
  if (file.size > 18 * 1024 * 1024) {
    toast('图片过大，建议压缩到 18MB 以内');
    return;
  }

  state.file = file;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    state.image = img;
    computeImageRect();
    initCropFromScale();
    drawCropCanvas();
    $('#emptyState').classList.add('hidden');
    $('#generateBtn').disabled = false;
    $('#uploadTitle').textContent = file.name;
    $('#uploadHint').textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
    toast('图片已载入，可以进入框选');
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    toast('图片读取失败');
  };
  img.src = url;
});

function computeImageRect() {
  if (!state.image) return;
  const cw = cropCanvas.width;
  const ch = cropCanvas.height;
  const iw = state.image.naturalWidth;
  const ih = state.image.naturalHeight;
  const scale = Math.min(cw / iw, ch / ih);
  const w = iw * scale;
  const h = ih * scale;
  state.imgRect = { x: (cw - w) / 2, y: (ch - h) / 2, w, h, scale };
}

function initCropFromScale() {
  if (!state.imgRect) return;
  const r = state.imgRect;
  const b = boardInfo();
  const aspect = b.outCols / b.outRows;
  const scale = Number($('#cropScale').value) / 100;

  let w = r.w * scale;
  let h = w / aspect;
  if (h > r.h * scale) {
    h = r.h * scale;
    w = h * aspect;
  }
  w = Math.min(w, r.w);
  h = Math.min(h, r.h);

  const center = state.crop
    ? { x: state.crop.x + state.crop.w / 2, y: state.crop.y + state.crop.h / 2 }
    : { x: r.x + r.w / 2, y: r.y + r.h / 2 };

  state.crop = clampCrop({ x: center.x - w / 2, y: center.y - h / 2, w, h });
}

function clampCrop(crop) {
  const r = state.imgRect;
  if (!r) return crop;
  crop.w = Math.max(26, Math.min(crop.w, r.w));
  crop.h = Math.max(26, Math.min(crop.h, r.h));
  crop.x = Math.max(r.x, Math.min(crop.x, r.x + r.w - crop.w));
  crop.y = Math.max(r.y, Math.min(crop.y, r.y + r.h - crop.h));
  return crop;
}

function handleRadius() {
  const rect = cropCanvas.getBoundingClientRect();
  return 26 * (cropCanvas.width / Math.max(1, rect.width));
}

function getHandles() {
  const c = state.crop;
  if (!c) return [];
  return [
    { mode: 'nw', x: c.x, y: c.y, anchor: { x: c.x + c.w, y: c.y + c.h } },
    { mode: 'ne', x: c.x + c.w, y: c.y, anchor: { x: c.x, y: c.y + c.h } },
    { mode: 'sw', x: c.x, y: c.y + c.h, anchor: { x: c.x + c.w, y: c.y } },
    { mode: 'se', x: c.x + c.w, y: c.y + c.h, anchor: { x: c.x, y: c.y } },
  ];
}

function hitTest(p) {
  const c = state.crop;
  if (!c) return { mode: 'none' };
  const hr = handleRadius();
  for (const h of getHandles()) {
    if (Math.hypot(p.x - h.x, p.y - h.y) <= hr) return h;
  }
  if (p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) return { mode: 'move' };
  return { mode: 'none' };
}

function canvasPoint(e) {
  const rect = cropCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (cropCanvas.width / rect.width),
    y: (e.clientY - rect.top) * (cropCanvas.height / rect.height),
  };
}

function applyMove(p) {
  state.crop.x = p.x - state.drag.offset.x;
  state.crop.y = p.y - state.drag.offset.y;
  state.crop = clampCrop(state.crop);
}

function applyResize(p) {
  const r = state.imgRect;
  const a = state.drag.anchor;
  const aspect = boardInfo().outCols / boardInfo().outRows;
  const mode = state.drag.mode;
  const sx = mode.includes('e') ? 1 : -1;
  const sy = mode.includes('s') ? 1 : -1;

  const maxWByX = sx > 0 ? (r.x + r.w - a.x) : (a.x - r.x);
  const maxHByY = sy > 0 ? (r.y + r.h - a.y) : (a.y - r.y);
  const maxW = Math.max(34, Math.min(maxWByX, maxHByY * aspect));
  const minW = Math.min(46, maxW);

  const rawW = Math.abs(p.x - a.x);
  const rawH = Math.abs(p.y - a.y);
  let w = Math.max(rawW, rawH * aspect);
  w = Math.max(minW, Math.min(maxW, w));
  const h = w / aspect;

  state.crop = {
    x: sx > 0 ? a.x : a.x - w,
    y: sy > 0 ? a.y : a.y - h,
    w,
    h,
  };
  state.crop = clampCrop(state.crop);
}

cropCanvas.addEventListener('pointerdown', (e) => {
  if (!state.crop) return;
  const p = canvasPoint(e);
  const hit = hitTest(p);
  if (hit.mode === 'none') return;

  e.preventDefault();
  cropCanvas.setPointerCapture(e.pointerId);
  cropCanvas.classList.add('dragging');
  state.drag.active = true;
  state.drag.mode = hit.mode;
  state.drag.pointerId = e.pointerId;

  if (hit.mode === 'move') {
    state.drag.offset = { x: p.x - state.crop.x, y: p.y - state.crop.y };
  } else {
    state.drag.anchor = hit.anchor;
  }
});

cropCanvas.addEventListener('pointermove', (e) => {
  const p = canvasPoint(e);
  if (!state.drag.active) {
    const hit = hitTest(p);
    cropCanvas.style.cursor = hit.mode === 'none' ? 'default' : (hit.mode === 'move' ? 'grab' : 'nwse-resize');
    return;
  }
  if (e.pointerId !== state.drag.pointerId) return;
  e.preventDefault();

  if (state.drag.mode === 'move') applyMove(p);
  else applyResize(p);
  drawCropCanvas();
});

function endDrag(e) {
  if (!state.drag.active) return;
  if (e && e.pointerId !== state.drag.pointerId) return;
  state.drag.active = false;
  state.drag.mode = 'none';
  state.drag.pointerId = null;
  cropCanvas.classList.remove('dragging');
}

cropCanvas.addEventListener('pointerup', endDrag);
cropCanvas.addEventListener('pointercancel', endDrag);
cropCanvas.addEventListener('lostpointercapture', endDrag);

function drawCropCanvas() {
  ctx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

  if (!state.image || !state.imgRect) return;
  const r = state.imgRect;
  ctx.drawImage(state.image, r.x, r.y, r.w, r.h);

  if (!state.crop) return;
  const c = state.crop;

  ctx.save();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.58)';
  ctx.beginPath();
  ctx.rect(0, 0, cropCanvas.width, cropCanvas.height);
  ctx.rect(c.x, c.y, c.w, c.h);
  ctx.fill('evenodd');
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.setLineDash([11, 7]);
  ctx.strokeRect(c.x, c.y, c.w, c.h);
  ctx.setLineDash([]);

  const { base, boardCols, boardRows } = boardInfo();
  ctx.strokeStyle = 'rgba(255, 218, 69, .96)';
  ctx.lineWidth = 2.6;
  for (let i = 1; i < boardCols; i++) {
    const x = c.x + (c.w / boardCols) * i;
    ctx.beginPath();
    ctx.moveTo(x, c.y);
    ctx.lineTo(x, c.y + c.h);
    ctx.stroke();
  }
  for (let i = 1; i < boardRows; i++) {
    const y = c.y + (c.h / boardRows) * i;
    ctx.beginPath();
    ctx.moveTo(c.x, y);
    ctx.lineTo(c.x + c.w, y);
    ctx.stroke();
  }

  drawBadge(`${base}格/板 · ${boardCols}×${boardRows}块`, c.x + 12, c.y + 12);
  drawHandles();
  ctx.restore();
}

function drawBadge(text, x, y) {
  ctx.font = '900 16px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 28;
  const h = 36;
  roundRect(ctx, x, y, w, h, 13, 'rgba(255,255,255,.96)', 'rgba(15,23,42,.10)');
  ctx.fillStyle = '#0f172a';
  ctx.fillText(text, x + 14, y + 24);
}

function drawHandles() {
  const hr = Math.max(10, handleRadius() * .48);
  getHandles().forEach(h => {
    ctx.beginPath();
    ctx.arc(h.x, h.y, hr, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#111827';
    ctx.stroke();
  });
}

function roundRect(ctx, x, y, w, h, r, fillStyle, strokeStyle) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }
}

function sourceCrop() {
  const c = state.crop;
  const r = state.imgRect;
  return {
    x: (c.x - r.x) / r.scale,
    y: (c.y - r.y) / r.scale,
    w: c.w / r.scale,
    h: c.h / r.scale,
  };
}

$('#generateBtn').addEventListener('click', async () => {
  if (!state.file || !state.crop) return toast('请先上传并框选图片');
  const b = boardInfo();
  const c = sourceCrop();
  const fd = new FormData();
  fd.append('image', state.file);
  fd.append('title', $('#titleInput').value.trim() || '拼豆像素图');
  fd.append('board_base', b.base);
  fd.append('board_cols', b.boardCols);
  fd.append('board_rows', b.boardRows);
  fd.append('crop_x', c.x);
  fd.append('crop_y', c.y);
  fd.append('crop_w', c.w);
  fd.append('crop_h', c.h);

  $('#generateBtn').disabled = true;
  $('#generateBtn').textContent = '生成中...';
  try {
    const data = await api('/api/generate', { method: 'POST', body: fd });
    showResult(data);
    setStep(3);
    toast('生成完成');
  } catch (err) {
    toast(err.message);
  } finally {
    $('#generateBtn').disabled = false;
    $('#generateBtn').textContent = '生成图纸';
  }
});

function showResult(result) {
  state.result = result;

  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  if (state.csvUrl) URL.revokeObjectURL(state.csvUrl);

  state.imageBlob = base64ToBlob(result.image_base64, 'image/png');
  state.imageUrl = URL.createObjectURL(state.imageBlob);
  state.csvBlob = new Blob([result.csv_text], { type: 'text/csv;charset=utf-8' });
  state.csvUrl = URL.createObjectURL(state.csvBlob);

  const filename = safeFilename(result.title || 'pindou');

  $('#resultImage').src = state.imageUrl;
  $('#resultImage').classList.remove('hidden');

  $('#downloadImage').href = state.imageUrl;
  $('#downloadImage').download = `${filename}.png`;
  $('#downloadImage').classList.remove('hidden');

  $('#downloadCsv').href = state.csvUrl;
  $('#downloadCsv').download = `${filename}.csv`;
  $('#downloadCsv').classList.remove('hidden');

  $('#saveImageBtn').classList.remove('hidden');
  $('#status').textContent = `已生成：${result.cols} × ${result.rows}，共 ${result.cols * result.rows} 颗豆。未保存到服务器，刷新页面后结果会消失。`;
  renderLegend(result.counts, result.colors || {});
}

function renderLegend(counts, colors) {
  const legend = $('#legend');
  legend.innerHTML = '';
  const entries = Object.entries(counts || {}).slice(0, 120);
  if (!entries.length) {
    legend.innerHTML = '<div class="status">暂无用色统计</div>';
    return;
  }
  entries.forEach(([code, count]) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    const color = colors[code] || '#ffffff';
    item.innerHTML = `<span class="legend-swatch" style="background:${escapeAttr(color)}"></span><span>${escapeHtml(code)}</span><span>×${count}</span>`;
    legend.appendChild(item);
  });
}

$('#saveImageBtn').addEventListener('click', async () => {
  if (!state.result || !state.imageBlob) return toast('还没有可保存的图片');
  const filename = `${safeFilename(state.result.title || 'pindou')}.png`;
  const file = new File([state.imageBlob], filename, { type: 'image/png' });

  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: '保存拼豆图纸', text: '拼豆像素图纸' });
      return;
    }
  } catch (err) {
    // 用户取消分享时不提示错误，继续提供下载兜底。
    if (err.name === 'AbortError') return;
  }

  $('#downloadImage').click();
  toast('已开始下载 PNG；手机端可在下载文件中查看');
});

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const chunks = [];
  const chunkSize = 8192;
  for (let i = 0; i < binary.length; i += chunkSize) {
    const slice = binary.slice(i, i + chunkSize);
    const bytes = new Uint8Array(slice.length);
    for (let j = 0; j < slice.length; j++) bytes[j] = slice.charCodeAt(j);
    chunks.push(bytes);
  }
  return new Blob(chunks, { type: mimeType });
}

function safeFilename(name) {
  return String(name).trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'pindou';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[s]));
}

function escapeAttr(str) {
  return String(str).replace(/["'<>]/g, '');
}

window.addEventListener('resize', () => drawCropCanvas());
window.addEventListener('beforeunload', () => {
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  if (state.csvUrl) URL.revokeObjectURL(state.csvUrl);
});

updateSizeText();

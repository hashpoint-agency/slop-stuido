// ── Canvas & state ────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d', { willReadFrequently:true });
const brushC = document.getElementById('brush-cursor');
const dropZ  = document.getElementById('drop-zone');

let origData  = null;
let workData  = null;
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 20;

let activeEffect  = 'pixelate';
let activeTab     = 'pixel';
let activeSlot    = 1;
let color1        = '#FFE000';
let color2        = '#000000';
let c1Transp      = false;
let c2Transp      = false;
let c1Alpha       = 255;
let c2Alpha       = 255;
let bayerSize     = 4;
let htShape       = 'circle';
let isDrawing     = false;
let lastPt        = null;

let viewZoom  = 1;
let viewPanX  = 0;
let viewPanY  = 0;
let isPanning = false;
let panLastX  = 0;
let panLastY  = 0;
let spaceDown = false;

let exportFormat  = 'jpg';
let exportScale   = 1;
let exportQuality = 85;
let exportBgMode  = 'alpha';
let exportBgColor = '#FFFFFF';

// ── Recent colors (localStorage) ─────────────────────────────────────
let recentColors = [];
try { recentColors = JSON.parse(localStorage.getItem('pgRecent') || '[]'); } catch {}
function saveRecent() { try { localStorage.setItem('pgRecent', JSON.stringify(recentColors)); } catch {} }
function pushRecent(hex) {
  if (!hex) return;
  recentColors = recentColors.filter(c => c.toLowerCase() !== hex.toLowerCase());
  recentColors.unshift(hex.toUpperCase());
  recentColors = recentColors.slice(0,10);
  saveRecent();
  renderRecent();
}
function renderRecent() {
  const el = document.getElementById('recentList');
  el.innerHTML = '';
  recentColors.forEach(hex => {
    const d = document.createElement('div');
    d.className = 'rswatch';
    d.style.background = hex;
    d.title = hex;
    d.addEventListener('click', () => applyRecent(hex));
    el.appendChild(d);
  });
}
function applyRecent(hex) {
  if (activeSlot === 1) { c1Transp = false; color1 = hex; }
  else                  { c2Transp = false; color2 = hex; }
  syncColor();
}
document.getElementById('clrRecent').addEventListener('click', () => {
  recentColors = []; saveRecent(); renderRecent();
});

// ── Effect → visible controls map ─────────────────────────────────────
const ECTRL = {
  pixelate:    ['brush','pixel','intensity','chaos','blend'],
  shuffle:     ['brush','pixel','chaos','blend'],
  scatter:     ['brush','pixel','intensity','chaos','blend','density'],
  glitch:      ['brush','pixel','intensity','chaos','blend','streak'],
  checker:     ['brush','pixel','chaos','blend'],
  dissolve:    ['brush','pixel','intensity','chaos','blend'],
  colorBlock:  ['brush','pixel','intensity','chaos','blend','density'],
  mosaic:      ['brush','pixel','chaos','blend'],
  corrupt:     ['brush','pixel','intensity','chaos','blend','streak','density'],
  erase:       ['brush'],
  colorErase:  ['tolerance'],
  ditherBayer: ['brush','dcell','threshold','levels','chaos','blend','bayerMx','ditherSrc'],
  ditherFS:    ['brush','dcell','threshold','spread','levels','chaos','blend','ditherSrc'],
  ditherAtk:   ['brush','dcell','threshold','spread','levels','chaos','blend','ditherSrc'],
  ditherHT:    ['brush','dcell','threshold','levels','chaos','blend','htShape','ditherSrc'],
};

const CROLES = {
  checker:    ['Color A','Color B'],
  scatter:    ['Scatter','—'],
  colorBlock: ['Color','—'],
  corrupt:    ['Streak','—'],
  ditherBayer:['Ink','Paper'],
  ditherFS:   ['Ink','Paper'],
  ditherAtk:  ['Ink','Paper'],
  ditherHT:   ['Ink','Paper'],
};

// ── Slider registry ───────────────────────────────────────────────────
const SL = {
  brush:     ['sBrush',    'vBrush'],
  pixel:     ['sPixel',    'vPixel'],
  dcell:     ['sDCell',    'vDCell'],
  intensity: ['sIntensity','vIntensity'],
  chaos:     ['sChaos',    'vChaos'],
  blend:     ['sBlend',    'vBlend'],
  streak:    ['sStreak',   'vStreak'],
  density:   ['sDensity',  'vDensity'],
  threshold: ['sThreshold','vThreshold'],
  spread:    ['sSpread',   'vSpread'],
  levels:    ['sLevels',   'vLevels'],
  tolerance: ['sTolerance','vTolerance'],
};
function val(k) { return parseInt(document.getElementById(SL[k][0]).value); }
function brushPx() {
  const sv = parseInt(document.getElementById('sBrush').value);
  return sv <= 700
    ? Math.round(10 + 240 * sv / 700)
    : Math.round(250 * Math.pow(12, (sv - 700) / 300));
}
Object.entries(SL).forEach(([key, [sid, vid]]) => {
  const sl = document.getElementById(sid);
  const vd = document.getElementById(vid);
  if (sl && vd) sl.addEventListener('input', () => { vd.textContent = key === 'brush' ? brushPx() : sl.value; });
});
let brushShape    = 'circle';
let ditherSrc     = 'orig';

// ── View transform (pan + zoom) ───────────────────────────────────────
function updateTransform() {
  canvas.style.transformOrigin = '0 0';
  canvas.style.transform = `translate(${viewPanX}px,${viewPanY}px) scale(${viewZoom})`;
  const r = brushPx();
  brushC.style.width  = Math.round(r * viewZoom) + 'px';
  brushC.style.height = Math.round(r * viewZoom) + 'px';
  const zb = document.getElementById('zoomBtn');
  if (zb) zb.textContent = Math.round(viewZoom * 100) + '%';
}
function setZoom(newZoom) {
  const wr = wrap.getBoundingClientRect();
  const cx = wr.width / 2, cy = wr.height / 2;
  viewPanX = cx - (cx - viewPanX) * (newZoom / viewZoom);
  viewPanY = cy - (cy - viewPanY) * (newZoom / viewZoom);
  viewZoom = newZoom;
  updateTransform();
}
function centerCanvas() {
  if (!canvas.width || !canvas.height) return;
  const wr = wrap.getBoundingClientRect();
  const fit = Math.min(wr.width / canvas.width, wr.height / canvas.height) * 0.9;
  viewZoom = Math.min(1, fit);
  viewPanX = (wr.width  - canvas.width  * viewZoom) / 2;
  viewPanY = (wr.height - canvas.height * viewZoom) / 2;
  updateTransform();
}

document.getElementById('sBrush').addEventListener('input', () => {
  const r = brushPx();
  brushC.style.width  = Math.round(r * viewZoom) + 'px';
  brushC.style.height = Math.round(r * viewZoom) + 'px';
});

document.getElementById('fillBtn').addEventListener('click', () => {
  if (!workData || activeEffect === 'colorErase') return;
  pushUndo();
  const W = canvas.width, H = canvas.height;
  const isDither = activeEffect.startsWith('dither');
  const ps = isDither ? val('dcell') : val('pixel');
  const blend = val('blend') / 100;
  const data = workData.data;
  const blocks = [];
  for (let by = 0; by < H; by += ps)
    for (let bx = 0; bx < W; bx += ps)
      blocks.push({bx, by});
  let preSnap = null;
  if (blend < 1) preSnap = new Uint8ClampedArray(workData.data);
  const fn = FX[activeEffect];
  if (fn) fn(data, W, H, blocks, ps);
  if (preSnap && blend < 1) {
    for (let i = 0; i < data.length; i += 4) {
      data[i]   = Math.round(preSnap[i]   + (data[i]   - preSnap[i])   * blend);
      data[i+1] = Math.round(preSnap[i+1] + (data[i+1] - preSnap[i+1]) * blend);
      data[i+2] = Math.round(preSnap[i+2] + (data[i+2] - preSnap[i+2]) * blend);
      data[i+3] = Math.round(preSnap[i+3] + (data[i+3] - preSnap[i+3]) * blend);
    }
  }
  ctx.putImageData(workData, 0, 0);
});
document.getElementById('brushCircle').addEventListener('click',()=>{
  brushShape='circle'; brushC.style.borderRadius='50%';
  document.getElementById('brushCircle').classList.add('active');
  document.getElementById('brushSquare').classList.remove('active');
});
document.getElementById('brushSquare').addEventListener('click',()=>{
  brushShape='square'; brushC.style.borderRadius='0';
  document.getElementById('brushSquare').classList.add('active');
  document.getElementById('brushCircle').classList.remove('active');
});
document.getElementById('ditherSrcOrig').addEventListener('click',()=>{
  ditherSrc='orig';
  document.getElementById('ditherSrcOrig').classList.add('active');
  document.getElementById('ditherSrcWork').classList.remove('active');
});
document.getElementById('ditherSrcWork').addEventListener('click',()=>{
  ditherSrc='work';
  document.getElementById('ditherSrcWork').classList.add('active');
  document.getElementById('ditherSrcOrig').classList.remove('active');
});
(function init() {
  const r = brushPx();
  document.getElementById('vBrush').textContent = r;
  brushC.style.width = Math.round(r*viewZoom)+'px';
  brushC.style.height = Math.round(r*viewZoom)+'px';
})();

// ── Control visibility ────────────────────────────────────────────────
function updateCtrls() {
  const show = ECTRL[activeEffect] || [];
  document.querySelectorAll('#ctrl-section [data-ctrl]').forEach(el => {
    el.classList.toggle('hidden', !show.includes(el.dataset.ctrl));
  });
  const roles = CROLES[activeEffect] || ['Foreground','Background'];
  document.getElementById('slotRole').textContent =
    `C1: ${roles[0]}  ·  C2: ${roles[1]}`;
}

// ── Tabs ──────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    document.getElementById('grid-pixel').classList.toggle('hidden', activeTab !== 'pixel');
    document.getElementById('grid-dither').classList.toggle('hidden', activeTab !== 'dither');
  });
});

// ── Effect selection ──────────────────────────────────────────────────
function selectEffect(eff) {
  activeEffect = eff;
  document.querySelectorAll('.effect-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.effect-btn[data-effect="${eff}"]`)?.classList.add('active');
  document.getElementById('tMode').textContent =
    eff.replace('dither','').replace(/([A-Z])/g,' $1').trim().toUpperCase() || 'RESTORE';
  updateCtrls();
}
document.querySelectorAll('.effect-btn').forEach(b => b.addEventListener('click', () => selectEffect(b.dataset.effect)));
updateCtrls();

// ── Mini buttons ──────────────────────────────────────────────────────
document.querySelectorAll('[data-bayer]').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('[data-bayer]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); bayerSize = parseInt(btn.dataset.bayer);
}));
document.querySelectorAll('[data-shape]').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('[data-shape]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); htShape = btn.dataset.shape;
}));

// ── Color helpers ─────────────────────────────────────────────────────
function getSlotColor(slot) { return slot === 1 ? color1 : color2; }
function isSlotTransp(slot) { return slot === 1 ? c1Transp : c2Transp; }

function syncColor() {
  const chip1 = document.getElementById('chip1');
  const chip2 = document.getElementById('chip2');
  chip1.classList.toggle('is-active', activeSlot === 1);
  chip2.classList.toggle('is-active', activeSlot === 2);
  chip1.classList.toggle('chip-transp', c1Transp);
  chip2.classList.toggle('chip-transp', c2Transp);
  if (!c1Transp) chip1.style.background = color1; else chip1.style.background = '';
  if (!c2Transp) chip2.style.background = color2; else chip2.style.background = '';

  document.getElementById('slotName').textContent = activeSlot === 1 ? 'Color 1' : 'Color 2';
  document.getElementById('t1btn').classList.toggle('active', c1Transp);
  document.getElementById('t2btn').classList.toggle('active', c2Transp);

  document.getElementById('sC1A').value = c1Alpha;
  document.getElementById('vC1A').textContent = c1Alpha;
  document.getElementById('sC2A').value = c2Alpha;
  document.getElementById('vC2A').textContent = c2Alpha;

  if (!isSlotTransp(activeSlot)) {
    const hex = getSlotColor(activeSlot);
    const [r,g,b] = hexRgb(hex);
    document.getElementById('rSl').value = r; document.getElementById('rV').textContent = r;
    document.getElementById('gSl').value = g; document.getElementById('gV').textContent = g;
    document.getElementById('bSl').value = b; document.getElementById('bV').textContent = b;
    document.getElementById('hexInput').value = hex.replace('#','').toUpperCase();
    document.getElementById('colorPicker').value = hex.length === 7 ? hex : '#' + hex.replace('#','');
    updateTracks(r,g,b);
  }
}

function updateTracks(r,g,b) {
  document.getElementById('rSl').style.background = `linear-gradient(to right,#111,rgb(255,${g},${b}))`;
  document.getElementById('gSl').style.background = `linear-gradient(to right,#111,rgb(${r},255,${b}))`;
  document.getElementById('bSl').style.background = `linear-gradient(to right,#111,rgb(${r},${g},255))`;
}

document.getElementById('chip1').addEventListener('click', () => { activeSlot=1; syncColor(); });
document.getElementById('chip2').addEventListener('click', () => { activeSlot=2; syncColor(); });

document.getElementById('swapBtn').addEventListener('click', () => {
  [color1,color2]=[color2,color1]; [c1Transp,c2Transp]=[c2Transp,c1Transp]; syncColor();
});
document.getElementById('resetBtn2').addEventListener('click', () => {
  color1='#FFE000'; color2='#000000'; c1Transp=false; c2Transp=false; activeSlot=1; syncColor();
});

document.getElementById('t1btn').addEventListener('click', () => {
  c1Transp=!c1Transp; if(!c1Transp) activeSlot=1; syncColor();
});
document.getElementById('t2btn').addEventListener('click', () => {
  c2Transp=!c2Transp; if(!c2Transp) activeSlot=2; syncColor();
});

document.getElementById('sC1A').addEventListener('input', e => {
  c1Alpha = +e.target.value;
  document.getElementById('vC1A').textContent = c1Alpha;
});
document.getElementById('sC2A').addEventListener('input', e => {
  c2Alpha = +e.target.value;
  document.getElementById('vC2A').textContent = c2Alpha;
});

function onRGB() {
  const r=parseInt(document.getElementById('rSl').value);
  const g=parseInt(document.getElementById('gSl').value);
  const b=parseInt(document.getElementById('bSl').value);
  document.getElementById('rV').textContent=r;
  document.getElementById('gV').textContent=g;
  document.getElementById('bV').textContent=b;
  const hex=rgbHex(r,g,b);
  document.getElementById('hexInput').value=hex.replace('#','').toUpperCase();
  updateTracks(r,g,b);
  if (activeSlot===1) { c1Transp=false; color1=hex; document.getElementById('chip1').style.background=hex; }
  else                { c2Transp=false; color2=hex; document.getElementById('chip2').style.background=hex; }
}
['rSl','gSl','bSl'].forEach(id => document.getElementById(id).addEventListener('input', onRGB));
['rSl','gSl','bSl'].forEach(id => document.getElementById(id).addEventListener('change', () => pushRecent(getSlotColor(activeSlot))));

document.getElementById('hexInput').addEventListener('input', e => {
  const v = e.target.value.replace(/[^0-9a-fA-F]/g,'');
  if (v.length===6) {
    const hex='#'+v.toUpperCase();
    if (activeSlot===1) { c1Transp=false; color1=hex; document.getElementById('chip1').style.background=hex; }
    else                { c2Transp=false; color2=hex; document.getElementById('chip2').style.background=hex; }
    const [r,g,b]=hexRgb(hex);
    document.getElementById('rSl').value=r; document.getElementById('rV').textContent=r;
    document.getElementById('gSl').value=g; document.getElementById('gV').textContent=g;
    document.getElementById('bSl').value=b; document.getElementById('bV').textContent=b;
    updateTracks(r,g,b);
  }
});
document.getElementById('hexInput').addEventListener('blur', () => pushRecent(getSlotColor(activeSlot)));

document.getElementById('colorPicker').addEventListener('input', e => {
  const hex = e.target.value.toUpperCase();
  if (activeSlot === 1) { c1Transp = false; color1 = hex; document.getElementById('chip1').style.background = hex; document.getElementById('chip1').classList.remove('chip-transp'); }
  else                  { c2Transp = false; color2 = hex; document.getElementById('chip2').style.background = hex; document.getElementById('chip2').classList.remove('chip-transp'); }
  const [r,g,b] = hexRgb(hex);
  document.getElementById('rSl').value = r; document.getElementById('rV').textContent = r;
  document.getElementById('gSl').value = g; document.getElementById('gV').textContent = g;
  document.getElementById('bSl').value = b; document.getElementById('bV').textContent = b;
  document.getElementById('hexInput').value = hex.replace('#','');
  updateTracks(r,g,b);
});
document.getElementById('colorPicker').addEventListener('change', e => {
  pushRecent(e.target.value.toUpperCase());
});

syncColor(); renderRecent();

// ── Image loading ─────────────────────────────────────────────────────
document.getElementById('fileIn').addEventListener('change', e => {
  if (e.target.files[0]) loadFile(e.target.files[0]);
});
const wrap = document.getElementById('canvas-wrap');
wrap.addEventListener('dragover', e => e.preventDefault());
wrap.addEventListener('drop', e => {
  e.preventDefault();
  const f=e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) loadFile(f);
});
wrap.addEventListener('wheel', e => {
  if (!e.metaKey) return;
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.04 : 1/1.04;
  const newZoom = Math.max(0.05, Math.min(32, viewZoom * factor));
  const wr = wrap.getBoundingClientRect();
  const mx = e.clientX - wr.left;
  const my = e.clientY - wr.top;
  viewPanX = mx - (mx - viewPanX) * (newZoom / viewZoom);
  viewPanY = my - (my - viewPanY) * (newZoom / viewZoom);
  viewZoom = newZoom;
  updateTransform();
}, { passive: false });
wrap.addEventListener('mousedown', e => {
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    e.preventDefault(); isPanning = true; panLastX = e.clientX; panLastY = e.clientY;
  }
});
wrap.addEventListener('mouseup', e => {
  if (e.button === 1 || (e.button === 0 && spaceDown)) isPanning = false;
});
wrap.addEventListener('mouseleave', () => { isPanning = false; });
function loadFile(file) {
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      let w=img.width, h=img.height;
      const mW=1400, mH=900;
      if(w>mW||h>mH){const s=Math.min(mW/w,mH/h);w=Math.round(w*s);h=Math.round(h*s);}
      canvas.width=w; canvas.height=h;
      ctx.drawImage(img,0,0,w,h);
      const id=ctx.getImageData(0,0,w,h);
      origData=new Uint8ClampedArray(id.data);
      workData=id; undoStack=[];
      updateUndoLabel();
      dropZ.style.display='none'; canvas.style.display='block';
      document.getElementById('tSize').textContent=`${w}×${h}`;
      updateExpSizeLabel();
      centerCanvas();
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Apply brush ───────────────────────────────────────────────────────
function applyAt(cx,cy){
  if(!workData)return;
  if(activeEffect==='colorErase'){
    if(lastPt===null) doColorErase(cx,cy);
    return;
  }
  const W=canvas.width,H=canvas.height;
  const R=brushPx()/2;
  const isDither=activeEffect.startsWith('dither');
  const ps=isDither?val('dcell'):val('pixel');
  const blend=val('blend')/100;
  const data=workData.data;

  const x0=Math.max(0,Math.floor((cx-R)/ps)*ps);
  const y0=Math.max(0,Math.floor((cy-R)/ps)*ps);
  const x1=Math.min(W,Math.ceil((cx+R)/ps)*ps);
  const y1=Math.min(H,Math.ceil((cy+R)/ps)*ps);

  const blocks=[];
  for(let by=y0;by<y1;by+=ps)for(let bx=x0;bx<x1;bx+=ps){
    const bcx=bx+ps/2,bcy=by+ps/2,dx=bcx-cx,dy=bcy-cy;
    const hit=brushShape==='square'?Math.abs(dx)<=R&&Math.abs(dy)<=R:dx*dx+dy*dy<=R*R;
    if(hit)blocks.push({bx,by});
  }
  if(!blocks.length)return;

  let preSnap=null;
  if(blend<1){
    preSnap=new Uint8ClampedArray(workData.data);
  }

  const fn=FX[activeEffect];
  if(fn)fn(data,W,H,blocks,ps);

  if(preSnap&&blend<1){
    for(let by2=y0;by2<y1;by2++)for(let bx2=x0;bx2<x1;bx2++){
      const i=(by2*W+bx2)*4;
      data[i]  =Math.round(preSnap[i]  +(data[i]  -preSnap[i]  )*blend);
      data[i+1]=Math.round(preSnap[i+1]+(data[i+1]-preSnap[i+1])*blend);
      data[i+2]=Math.round(preSnap[i+2]+(data[i+2]-preSnap[i+2])*blend);
      data[i+3]=Math.round(preSnap[i+3]+(data[i+3]-preSnap[i+3])*blend);
    }
  }

  ctx.putImageData(workData,0,0);
}

// ── Stroke interpolation ──────────────────────────────────────────────
function strokeTo(pt){
  if(!lastPt){applyAt(pt.x,pt.y);lastPt=pt;return;}
  const dx=pt.x-lastPt.x,dy=pt.y-lastPt.y;
  const dist=Math.hypot(dx,dy);
  const step=Math.max(3,brushPx()/5);
  if(dist<step)return;
  const steps=Math.ceil(dist/step);
  for(let i=1;i<=steps;i++)applyAt(Math.round(lastPt.x+dx*i/steps),Math.round(lastPt.y+dy*i/steps));
  lastPt=pt;
}

// ── Canvas position ────────────────────────────────────────────────────
function canvasPos(e){
  const r=canvas.getBoundingClientRect();
  return{x:Math.round((e.clientX-r.left)*canvas.width/r.width),y:Math.round((e.clientY-r.top)*canvas.height/r.height)};
}

// ── Mouse ─────────────────────────────────────────────────────────────
canvas.addEventListener('mousedown',e=>{
  if(!workData||e.button!==0||spaceDown)return;
  isDrawing=true;lastPt=null;
  pushUndo();strokeTo(canvasPos(e));
});
canvas.addEventListener('mousemove',e=>{
  brushC.style.left=e.clientX+'px';brushC.style.top=e.clientY+'px';
  if(!workData)return;
  const{x,y}=canvasPos(e);
  document.getElementById('tCoord').textContent=`x:${x} y:${y}`;
  if(isDrawing)strokeTo({x,y});
});
canvas.addEventListener('mouseup',()=>{isDrawing=false;lastPt=null;});
canvas.addEventListener('mouseleave',()=>{isDrawing=false;lastPt=null;brushC.style.display='none';});
canvas.addEventListener('mouseenter',()=>{brushC.style.display='block';});
wrap.addEventListener('mousemove',e=>{
  brushC.style.left=e.clientX+'px';brushC.style.top=e.clientY+'px';
  if(isPanning){
    viewPanX+=e.clientX-panLastX; viewPanY+=e.clientY-panLastY;
    panLastX=e.clientX; panLastY=e.clientY;
    updateTransform();
  }
});

// ── Touch ─────────────────────────────────────────────────────────────
canvas.addEventListener('touchstart',e=>{e.preventDefault();if(!workData)return;isDrawing=true;lastPt=null;pushUndo();strokeTo(canvasPos(e.touches[0]));},{passive:false});
canvas.addEventListener('touchmove',e=>{e.preventDefault();if(isDrawing)strokeTo(canvasPos(e.touches[0]));},{passive:false});
canvas.addEventListener('touchend',()=>{isDrawing=false;lastPt=null;});

// ── Undo ──────────────────────────────────────────────────────────────
function pushUndo(){
  if(!workData)return;
  if(undoStack.length>=MAX_UNDO)undoStack.shift();
  undoStack.push(new Uint8ClampedArray(workData.data));
  redoStack=[];
  updateUndoLabel();
}
function updateUndoLabel(){
  document.getElementById('tUndo').textContent=`UNDO: ${undoStack.length}  REDO: ${redoStack.length}`;
}
function doUndo(){
  if(!undoStack.length||!workData)return;
  redoStack.push(new Uint8ClampedArray(workData.data));
  workData.data.set(undoStack.pop());
  ctx.putImageData(workData,0,0);
  updateUndoLabel();
}
function doRedo(){
  if(!redoStack.length||!workData)return;
  undoStack.push(new Uint8ClampedArray(workData.data));
  workData.data.set(redoStack.pop());
  ctx.putImageData(workData,0,0);
  updateUndoLabel();
}
document.getElementById('undoBtn').addEventListener('click',doUndo);
document.getElementById('redoBtn').addEventListener('click',doRedo);

document.getElementById('resetBtn').addEventListener('click',()=>{
  if(!origData||!workData)return;
  pushUndo();workData.data.set(origData);ctx.putImageData(workData,0,0);
});

// ── Export panel ──────────────────────────────────────────────────────
function updateExpSizeLabel(){
  const el=document.getElementById('expSizeLabel');
  if(!canvas.width||!canvas.height){el.textContent='—';return;}
  const W=Math.round(canvas.width*exportScale);
  const H=Math.round(canvas.height*exportScale);
  el.textContent=`${W} × ${H} px  ·  ${exportFormat.toUpperCase()}`;
}

document.getElementById('expFmtPng').addEventListener('click',()=>{
  exportFormat='png';
  document.getElementById('expFmtPng').classList.add('active');
  document.getElementById('expFmtJpg').classList.remove('active');
  document.getElementById('jpgQRow').classList.add('hidden');
  document.getElementById('pngBgSection').classList.remove('hidden');
  updateExpSizeLabel();
});
document.getElementById('expFmtJpg').addEventListener('click',()=>{
  exportFormat='jpg';
  document.getElementById('expFmtJpg').classList.add('active');
  document.getElementById('expFmtPng').classList.remove('active');
  document.getElementById('jpgQRow').classList.remove('hidden');
  document.getElementById('pngBgSection').classList.add('hidden');
  updateExpSizeLabel();
});

document.querySelectorAll('#scaleRow .mini-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('#scaleRow .mini-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    exportScale=parseFloat(btn.dataset.scale);
    updateExpSizeLabel();
  });
});

document.getElementById('sJpgQ').addEventListener('input',e=>{
  exportQuality=+e.target.value;
  document.getElementById('vJpgQ').textContent=exportQuality;
});

document.getElementById('expBgAlpha').addEventListener('click',()=>{
  exportBgMode='alpha';
  document.getElementById('expBgAlpha').classList.add('active');
  document.getElementById('expBgColor').classList.remove('active');
  document.getElementById('pngBgColorPick').classList.add('hidden');
});
document.getElementById('expBgColor').addEventListener('click',()=>{
  exportBgMode='color';
  document.getElementById('expBgColor').classList.add('active');
  document.getElementById('expBgAlpha').classList.remove('active');
  document.getElementById('pngBgColorPick').classList.remove('hidden');
});

document.getElementById('pngBgHex').addEventListener('input',e=>{
  const v=e.target.value.replace(/[^0-9a-fA-F]/g,'');
  if(v.length===6){exportBgColor='#'+v.toUpperCase();document.getElementById('pngBgPicker').value=exportBgColor;}
});
document.getElementById('pngBgPicker').addEventListener('input',e=>{
  exportBgColor=e.target.value.toUpperCase();
  document.getElementById('pngBgHex').value=exportBgColor.replace('#','');
});

document.getElementById('exportBtn').addEventListener('click',()=>{
  if(!canvas.width||!workData)return;
  const W=Math.round(canvas.width*exportScale);
  const H=Math.round(canvas.height*exportScale);
  const tmp=document.createElement('canvas');
  tmp.width=W; tmp.height=H;
  const tc=tmp.getContext('2d');
  if(exportFormat==='jpg'){
    tc.fillStyle='#FFFFFF'; tc.fillRect(0,0,W,H);
  } else if(exportBgMode==='color'){
    tc.fillStyle=exportBgColor; tc.fillRect(0,0,W,H);
  }
  tc.imageSmoothingEnabled=exportScale<1;
  tc.drawImage(canvas,0,0,W,H);
  const mime=exportFormat==='jpg'?'image/jpeg':'image/png';
  const quality=exportFormat==='jpg'?exportQuality/100:undefined;
  const url=tmp.toDataURL(mime,quality);
  const a=document.createElement('a');
  a.download=`pixel-glitch.${exportFormat}`;
  a.href=url; a.click();
});

// ── Keyboard ──────────────────────────────────────────────────────────
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey){e.preventDefault();doUndo();}
  if((e.ctrlKey||e.metaKey)&&e.key==='z'&&e.shiftKey){e.preventDefault();doRedo();}
  if((e.ctrlKey||e.metaKey)&&e.key==='y'){e.preventDefault();doRedo();}
  if(e.key==='['){const sl=document.getElementById('sBrush');sl.value=Math.max(0,+sl.value-30);sl.dispatchEvent(new Event('input'));}
  if(e.key===']'){const sl=document.getElementById('sBrush');sl.value=Math.min(1000,+sl.value+30);sl.dispatchEvent(new Event('input'));}
  if(e.key===' '&&!spaceDown&&!e.target.matches('input,textarea')){
    spaceDown=true; canvas.style.cursor='grab'; brushC.style.display='none'; e.preventDefault();
  }
});
document.addEventListener('keyup',e=>{
  if(e.key===' '){spaceDown=false;isPanning=false;canvas.style.cursor='none';brushC.style.display='block';}
});

// ── Zoom button + presets ─────────────────────────────────────────────
const zoomBtn  = document.getElementById('zoomBtn');
const zoomMenu = document.getElementById('zoom-menu');
zoomBtn.addEventListener('click', e => {
  e.stopPropagation();
  zoomMenu.classList.toggle('hidden');
});
document.querySelectorAll('#zoom-menu [data-zoom]').forEach(btn => {
  btn.addEventListener('click', () => {
    zoomMenu.classList.add('hidden');
    if (btn.dataset.zoom === 'fit') { centerCanvas(); return; }
    setZoom(parseFloat(btn.dataset.zoom));
  });
});
document.addEventListener('click', () => zoomMenu.classList.add('hidden'));

/* ----------------------- 可調整的雜誌參數 ----------------------- */
const pages = [
  "./assets/source-cover.png",
  "./assets/page-02-warm.png",
  "./assets/page-03-open.png",
  "./assets/page-04-sharp.png",
  "./assets/page-05-tech.png",
  "./assets/page-06-professional.png",
];
const completionThreshold = 0.25;
const turnDuration = 620;
const returnDuration = 380;
const shadowStrength = 0.58;
const curlRadius = 0.23; // 頁寬／頁高比例；此數值亦影響可抓取的頁角範圍
/* ---------------------------------------------------------------- */

const canvas = document.querySelector("#magazineCanvas");
const bookShell = document.querySelector("#bookShell");
const pageCount = document.querySelector("#pageCount");
const progressBar = document.querySelector("#progressBar");
const navPrevious = document.querySelector('[data-action="previous"]');
const navNext = document.querySelector('[data-action="next"]');
const context = canvas.getContext("2d");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let images = [];
let currentIndex = 0;
let activeTurn = null;
let animating = false;
let dimensions = { width: 1, height: 1, dpr: 1 };

function preload(source) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ image, ratio: image.naturalWidth / image.naturalHeight, ok: true });
    image.onerror = () => resolve({ image: null, ratio: 1, ok: false });
    image.src = source;
  });
}

function updateControls() {
  const page = String(currentIndex + 1).padStart(2, "0");
  const total = String(pages.length).padStart(2, "0");
  pageCount.textContent = `${page} / ${total}`;
  progressBar.style.width = `${((currentIndex + 1) / pages.length) * 100}%`;
  navPrevious.disabled = animating || currentIndex === 0;
  navNext.disabled = animating || currentIndex === pages.length - 1;
}

function resizeCanvas() {
  const box = bookShell.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  dimensions = { width: Math.max(1, box.width), height: Math.max(1, box.height), dpr };
  canvas.width = Math.round(dimensions.width * dpr);
  canvas.height = Math.round(dimensions.height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function roundedPagePath(ctx, w, h) {
  const r = Math.min(5, w * .018);
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, r);
}

function drawBlankPage(ctx, w, h, label = "IMAGE UNAVAILABLE") {
  const wash = ctx.createLinearGradient(0, 0, w, h);
  wash.addColorStop(0, "#f8f1e7"); wash.addColorStop(1, "#e7dcc9");
  ctx.fillStyle = wash; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#805a45"; ctx.font = `${Math.max(10, w * .034)}px Arial`; ctx.textAlign = "center";
  ctx.fillText(label, w / 2, h / 2);
}

// 先以模糊 cover 填滿書頁，再以 top-aligned contain 放上原圖；所以不同來源比例不會變形或裁到頭部。
function drawMagazinePage(ctx, item) {
  const { width: w, height: h } = dimensions;
  if (!item || !item.ok) { drawBlankPage(ctx, w, h); return; }
  const image = item.image;
  const coverScale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const coverW = image.naturalWidth * coverScale;
  const coverH = image.naturalHeight * coverScale;
  ctx.save();
  ctx.filter = "blur(18px) saturate(.76) brightness(.83)";
  ctx.globalAlpha = .88;
  ctx.drawImage(image, (w - coverW) / 2, (h - coverH) / 2, coverW, coverH);
  ctx.restore();
  ctx.fillStyle = "rgba(63, 36, 28, .16)"; ctx.fillRect(0, 0, w, h);
  const containScale = Math.min(w / image.naturalWidth, h / image.naturalHeight);
  const drawW = image.naturalWidth * containScale;
  const drawH = image.naturalHeight * containScale;
  const x = (w - drawW) / 2;
  ctx.save();
  ctx.shadowColor = "rgba(41, 21, 15, .18)"; ctx.shadowBlur = 15; ctx.shadowOffsetY = 8;
  ctx.drawImage(image, x, 0, drawW, drawH);
  ctx.restore();
  if (drawH < h) {
    const fade = ctx.createLinearGradient(0, drawH - 22, 0, h);
    fade.addColorStop(0, "rgba(255,255,255,0)"); fade.addColorStop(1, "rgba(54,27,20,.16)");
    ctx.fillStyle = fade; ctx.fillRect(0, drawH - 22, w, h - drawH + 22);
  }
}

function clipHalfPlane(points, midpoint, normal, wantedSign) {
  const inside = (p) => (p.x - midpoint.x) * normal.x * wantedSign + (p.y - midpoint.y) * normal.y * wantedSign >= -0.001;
  const crossing = (a, b) => {
    const ad = ((a.x - midpoint.x) * normal.x + (a.y - midpoint.y) * normal.y) * wantedSign;
    const bd = ((b.x - midpoint.x) * normal.x + (b.y - midpoint.y) * normal.y) * wantedSign;
    const t = ad / (ad - bd);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };
  const result = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]; const b = points[(i + 1) % points.length];
    const aInside = inside(a); const bInside = inside(b);
    if (aInside) result.push(a);
    if (aInside !== bInside) result.push(crossing(a, b));
  }
  return result;
}

function polygonPath(ctx, points) {
  if (!points.length) return;
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
}

function drawPaperTexture(ctx, w, h) {
  ctx.fillStyle = "rgba(249, 243, 229, .89)"; ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = .14;
  for (let y = 4; y < h; y += 7) { ctx.fillStyle = y % 14 ? "#ba9d76" : "#fffaf0"; ctx.fillRect(0, y, w, 1); }
  ctx.globalAlpha = 1;
}

function drawTurn(turn) {
  const { width: w, height: h } = dimensions;
  const sourceIndex = turn.direction === "next" ? currentIndex : currentIndex - 1;
  const underlyingIndex = turn.direction === "next" ? currentIndex + 1 : currentIndex;
  const source = images[sourceIndex];
  const underlying = images[underlyingIndex];
  const corner = { x: turn.direction === "next" ? w : 0, y: turn.fromTop ? 0 : h };
  const grabbed = { x: turn.x, y: turn.y };
  const vector = { x: grabbed.x - corner.x, y: grabbed.y - corner.y };
  const length = Math.max(1, Math.hypot(vector.x, vector.y));
  const normal = { x: vector.x / length, y: vector.y / length };
  const midpoint = { x: (corner.x + grabbed.x) / 2, y: (corner.y + grabbed.y) / 2 };
  const rectangle = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const cornerSign = ((corner.x - midpoint.x) * normal.x + (corner.y - midpoint.y) * normal.y) >= 0 ? 1 : -1;
  const flap = clipHalfPlane(rectangle, midpoint, normal, cornerSign);
  const remaining = clipHalfPlane(rectangle, midpoint, normal, -cornerSign);

  drawMagazinePage(context, underlying);
  context.save(); polygonPath(context, remaining); context.clip(); drawMagazinePage(context, source); context.restore();

  // 對折線做鏡射：反射矩陣讓畫面的角真正翻向背面，而不是 Y 軸轉場。
  const dot = normal.x * midpoint.x + normal.y * midpoint.y;
  const a = 1 - 2 * normal.x * normal.x;
  const b = -2 * normal.x * normal.y;
  const c = -2 * normal.x * normal.y;
  const d = 1 - 2 * normal.y * normal.y;
  const e = 2 * normal.x * dot;
  const f = 2 * normal.y * dot;
  context.save();
  context.transform(a, b, c, d, e, f);
  polygonPath(context, flap); context.clip();
  drawPaperTexture(context, w, h);
  context.restore();

  // 摺痕陰影、高光和流動的光掃，以摺線中央為中心隨拖曳量移動。
  const foldDistance = Math.min(1, length / Math.hypot(w, h));
  const shadowSize = Math.max(25, w * (.12 + foldDistance * .22));
  const shadow = context.createRadialGradient(midpoint.x, midpoint.y, 0, midpoint.x, midpoint.y, shadowSize);
  shadow.addColorStop(0, `rgba(45, 20, 12, ${shadowStrength * (1 - foldDistance * .3)})`);
  shadow.addColorStop(.55, `rgba(77, 38, 18, ${shadowStrength * .18})`); shadow.addColorStop(1, "rgba(60, 25, 15, 0)");
  context.save(); polygonPath(context, flap); context.clip(); context.fillStyle = shadow; context.fillRect(midpoint.x - shadowSize, midpoint.y - shadowSize, shadowSize * 2, shadowSize * 2); context.restore();
  context.save();
  context.strokeStyle = "rgba(255, 246, 219, .82)"; context.lineWidth = Math.max(1, w * .005);
  context.shadowColor = "rgba(84, 39, 20, .75)"; context.shadowBlur = 7;
  const tangent = { x: -normal.y, y: normal.x };
  context.beginPath(); context.moveTo(midpoint.x - tangent.x * h, midpoint.y - tangent.y * h); context.lineTo(midpoint.x + tangent.x * h, midpoint.y + tangent.y * h); context.stroke();
  context.restore();
}

function draw() {
  const { width: w, height: h } = dimensions;
  context.setTransform(dimensions.dpr, 0, 0, dimensions.dpr, 0, 0);
  context.clearRect(0, 0, w, h);
  context.save(); roundedPagePath(context, w, h); context.clip();
  if (activeTurn) drawTurn(activeTurn); else drawMagazinePage(context, images[currentIndex]);
  context.restore();
  context.save(); roundedPagePath(context, w, h); context.strokeStyle = "rgba(111, 67, 43, .22)"; context.lineWidth = 1; context.stroke(); context.restore();
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * dimensions.width / rect.width, y: (event.clientY - rect.top) * dimensions.height / rect.height };
}

function isCorner(position) {
  const { width: w, height: h } = dimensions;
  const edgeW = w * curlRadius;
  const edgeH = h * curlRadius;
  const topOrBottom = position.y < edgeH || position.y > h - edgeH;
  if (!topOrBottom) return null;
  if (position.x > w - edgeW && currentIndex < pages.length - 1) return { direction: "next", fromTop: position.y < h / 2 };
  if (position.x < edgeW && currentIndex > 0) return { direction: "previous", fromTop: position.y < h / 2 };
  return null;
}

function progressOf(turn) {
  const { width: w } = dimensions;
  return turn.direction === "next" ? Math.max(0, Math.min(1, (w - turn.x) / w)) : Math.max(0, Math.min(1, turn.x / w));
}

function constrainedPosition(position, turn) {
  const { width: w, height: h } = dimensions;
  const x = Math.max(0, Math.min(w, position.x));
  const y = Math.max(0, Math.min(h, position.y));
  return { x: turn.direction === "next" ? Math.min(w, x) : Math.max(0, x), y };
}

function animateTurn(turn, targetProgress, duration, onDone) {
  const start = performance.now();
  const startX = turn.x; const startY = turn.y;
  const { width: w, height: h } = dimensions;
  const finalX = turn.direction === "next" ? w * (1 - targetProgress) : w * targetProgress;
  const finalY = turn.fromTop ? h * (.07 + targetProgress * .1) : h * (.93 - targetProgress * .1);
  const total = reducedMotion ? 0 : duration;
  const step = (now) => {
    const linear = total ? Math.min(1, (now - start) / total) : 1;
    const ease = 1 - Math.pow(1 - linear, 4);
    turn.x = startX + (finalX - startX) * ease;
    turn.y = startY + (finalY - startY) * ease;
    draw();
    if (linear < 1) requestAnimationFrame(step); else onDone();
  };
  requestAnimationFrame(step);
}

function finishTurn(complete) {
  if (!activeTurn || animating) return;
  animating = true; updateControls();
  const finished = activeTurn;
  animateTurn(finished, complete ? 1 : 0, complete ? turnDuration : returnDuration, () => {
    if (complete) currentIndex += finished.direction === "next" ? 1 : -1;
    activeTurn = null; animating = false; canvas.classList.remove("is-dragging"); draw(); updateControls();
  });
}

canvas.addEventListener("pointerdown", (event) => {
  if (animating || activeTurn || event.pointerType === "mouse" && event.button !== 0) return;
  const position = pointerPosition(event); const corner = isCorner(position);
  if (!corner) return;
  activeTurn = { ...corner, ...position, pointerId: event.pointerId };
  canvas.setPointerCapture(event.pointerId); canvas.classList.add("is-dragging");
  event.preventDefault(); draw();
});
canvas.addEventListener("pointermove", (event) => {
  if (!activeTurn || activeTurn.pointerId !== event.pointerId || animating) return;
  Object.assign(activeTurn, constrainedPosition(pointerPosition(event), activeTurn));
  event.preventDefault(); draw();
});
function releasePointer(event) {
  if (!activeTurn || activeTurn.pointerId !== event.pointerId || animating) return;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  finishTurn(progressOf(activeTurn) >= completionThreshold);
}
canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);

function beginAutomaticTurn(direction) {
  if (animating || activeTurn) return;
  if (direction === "next" && currentIndex >= pages.length - 1) return;
  if (direction === "previous" && currentIndex <= 0) return;
  const { width: w, height: h } = dimensions;
  activeTurn = { direction, fromTop: true, x: direction === "next" ? w : 0, y: h * .04 };
  finishTurn(true);
}
navPrevious.addEventListener("click", () => beginAutomaticTurn("previous"));
navNext.addEventListener("click", () => beginAutomaticTurn("next"));
window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") { event.preventDefault(); beginAutomaticTurn("previous"); }
  if (event.key === "ArrowRight") { event.preventDefault(); beginAutomaticTurn("next"); }
});
window.addEventListener("resize", resizeCanvas, { passive: true });

Promise.all(pages.map(preload)).then((loaded) => {
  images = loaded;
  const missing = loaded.filter((item) => !item.ok).length;
  if (missing) console.warn(`${missing} 張雜誌圖片無法載入。請檢查 app.js 的 pages 陣列。`);
  resizeCanvas(); updateControls();
});

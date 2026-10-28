const VELOCITY_THRESHOLD = 0.38;

export function sheetSnapPoints(height, peekHeight = 76) {
  const collapsed = Math.max(0, Math.round(height - peekHeight));
  if (collapsed < 72) return [0];
  const compact = Math.round(Math.min(collapsed - 36, Math.max(76, collapsed * 0.54)));
  return [...new Set([0, compact, collapsed])].sort((a, b) => a - b);
}

export function chooseSheetSnap(offset, snaps, velocity = 0) {
  if (!snaps.length) return 0;
  const nearestIndex = snaps.reduce((bestIndex, snap, index) => (
    Math.abs(snap - offset) < Math.abs(snaps[bestIndex] - offset) ? index : bestIndex
  ), 0);
  if (Math.abs(velocity) < VELOCITY_THRESHOLD) return snaps[nearestIndex];
  if (velocity > 0) return snaps[Math.min(snaps.length - 1, nearestIndex + 1)];
  return snaps[Math.max(0, nearestIndex - 1)];
}

export function createBottomSheet(sheet, handle, {
  onStateChange,
  initialState = "expanded",
  peekHeight = 76
} = {}) {
  const getPeekHeight = () => typeof peekHeight === "function" ? peekHeight() : peekHeight;
  let snaps = sheetSnapPoints(sheet.getBoundingClientRect().height, getPeekHeight());
  let snapIndex = 0;
  let offset = snaps[snapIndex];
  let pointer = null;
  let dragged = false;

  function stateName() {
    if (snapIndex === 0) return "expanded";
    if (snapIndex === snaps.length - 1) return "collapsed";
    return "compact";
  }

  function apply(nextOffset, animate = true) {
    offset = Math.max(0, Math.min(snaps.at(-1) ?? 0, nextOffset));
    sheet.classList.toggle("is-dragging", !animate);
    sheet.style.setProperty("--sheet-offset", `${offset}px`);
  }

  function commit(target) {
    snapIndex = Math.max(0, snaps.indexOf(target));
    apply(snaps[snapIndex], true);
    const name = stateName();
    sheet.dataset.sheetState = name;
    handle.setAttribute("aria-expanded", String(name === "expanded"));
    handle.setAttribute("aria-label", name === "expanded" ? "Fenster nach unten ziehen" : "Fenster nach oben ziehen");
    onStateChange?.(name);
  }

  function refresh() {
    const name = stateName();
    snaps = sheetSnapPoints(sheet.getBoundingClientRect().height, getPeekHeight());
    snapIndex = name === "expanded" ? 0 : name === "collapsed" ? snaps.length - 1 : Math.min(1, snaps.length - 1);
    commit(snaps[snapIndex]);
  }

  function onPointerDown(event) {
    if (event.button !== 0 || pointer) return;
    handle.setPointerCapture(event.pointerId);
    pointer = {
      id: event.pointerId,
      startY: event.clientY,
      startOffset: offset,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0
    };
    dragged = false;
    sheet.classList.add("is-dragging");
  }

  function onPointerMove(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const delta = event.clientY - pointer.startY;
    if (Math.abs(delta) > 4) dragged = true;
    const elapsed = Math.max(1, event.timeStamp - pointer.lastTime);
    pointer.velocity = (event.clientY - pointer.lastY) / elapsed;
    pointer.lastY = event.clientY;
    pointer.lastTime = event.timeStamp;
    apply(pointer.startOffset + delta, false);
  }

  function onPointerEnd(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const velocity = pointer.velocity;
    pointer = null;
    const target = chooseSheetSnap(offset, snaps, velocity);
    commit(target);
  }

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerEnd);
  handle.addEventListener("pointercancel", onPointerEnd);
  handle.addEventListener("click", () => {
    if (dragged) {
      dragged = false;
      return;
    }
    commit(snaps[snapIndex === 0 ? snaps.length - 1 : 0]);
  });
  handle.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      commit(snaps[Math.min(snaps.length - 1, snapIndex + 1)]);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      commit(snaps[Math.max(0, snapIndex - 1)]);
    }
  });

  new ResizeObserver(refresh).observe(sheet);
  commit(initialState === "collapsed" ? snaps.at(-1) : snaps[0]);

  return {
    collapse: () => commit(snaps.at(-1)),
    expand: () => commit(snaps[0]),
    refresh,
    getState: stateName
  };
}

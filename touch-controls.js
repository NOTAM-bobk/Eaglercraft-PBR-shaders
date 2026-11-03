(() => {
  "use strict";

  const gameFrame = document.getElementById("game_frame");
  if (!gameFrame) return;

  const compactViewport = window.matchMedia(
    "(pointer: coarse), (hover: none), (max-width: 860px)"
  );
  const keyDefinitions = {
    KeyW: { key: "w", code: "KeyW", keyCode: 87 },
    KeyA: { key: "a", code: "KeyA", keyCode: 65 },
    KeyS: { key: "s", code: "KeyS", keyCode: 83 },
    KeyD: { key: "d", code: "KeyD", keyCode: 68 },
    Space: { key: " ", code: "Space", keyCode: 32 },
    ShiftLeft: { key: "Shift", code: "ShiftLeft", keyCode: 16 },
    ControlLeft: { key: "Control", code: "ControlLeft", keyCode: 17 },
    KeyE: { key: "e", code: "KeyE", keyCode: 69 },
    KeyQ: { key: "q", code: "KeyQ", keyCode: 81 },
    Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  };
  const keySources = new Map();
  const mouseSources = new Map();
  const activeButtons = new Map();
  let lookPointer = null;
  let manuallyToggled = false;

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  const toggle = createElement(
    "button",
    "touch-controls-toggle",
    "Touch controls"
  );
  toggle.type = "button";
  toggle.setAttribute("aria-controls", "touch-controls");

  const controls = createElement("div", "touch-controls");
  controls.id = "touch-controls";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "On-screen game controls");

  const lookPad = createElement("div", "touch-controls__look-pad");
  lookPad.setAttribute("role", "region");
  lookPad.setAttribute(
    "aria-label",
    "Swipe to look around or tap to select"
  );

  const lookHint = createElement(
    "div",
    "touch-controls__hint",
    "Swipe to look · tap to select"
  );
  lookHint.setAttribute("aria-hidden", "true");

  const movement = createElement("div", "touch-controls__dpad");
  movement.setAttribute("role", "group");
  movement.setAttribute("aria-label", "Movement controls");

  const centerLabel = createElement(
    "span",
    "touch-controls__dpad-center",
    "MOVE"
  );
  centerLabel.setAttribute("aria-hidden", "true");

  function createControl(text, label, options = {}) {
    const button = createElement(
      "button",
      `touch-controls__button ${options.className || ""}`.trim(),
      text
    );
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", "false");
    if (options.key) button.dataset.key = options.key;
    if (options.mouseButton !== undefined) {
      button.dataset.mouseButton = String(options.mouseButton);
    }
    button.addEventListener("pointerdown", handleButtonPointerDown);
    button.addEventListener("lostpointercapture", releaseButtonPointer);
    return button;
  }

  [
    { text: "↑", label: "Move forward", key: "KeyW", direction: "up" },
    { text: "←", label: "Move left", key: "KeyA", direction: "left" },
    { text: "→", label: "Move right", key: "KeyD", direction: "right" },
    { text: "↓", label: "Move backward", key: "KeyS", direction: "down" },
  ].forEach(({ text, label, key, direction }) => {
    movement.append(
      createControl(text, label, {
        key,
        className: `touch-controls__direction touch-controls__direction--${direction}`,
      })
    );
  });
  movement.append(centerLabel);

  const actions = createElement("div", "touch-controls__actions");
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Action controls");

  [
    { text: "MENU", label: "Open menu", key: "Escape", action: "menu" },
    { text: "JUMP", label: "Jump", key: "Space", action: "jump" },
    { text: "HIT", label: "Attack", mouseButton: 0, action: "attack" },
    { text: "SNEAK", label: "Sneak", key: "ShiftLeft", action: "sneak" },
    { text: "USE", label: "Use item", mouseButton: 2, action: "use" },
    { text: "RUN", label: "Sprint", key: "ControlLeft", action: "sprint" },
    { text: "BAG", label: "Open inventory", key: "KeyE", action: "inventory" },
    { text: "DROP", label: "Drop item", key: "KeyQ", action: "drop" },
  ].forEach(({ text, label, key, mouseButton, action }) => {
    actions.append(
      createControl(text, label, {
        key,
        mouseButton,
        className: `touch-controls__action touch-controls__action--${action}`,
      })
    );
  });

  controls.append(lookPad, lookHint, movement, actions);
  gameFrame.append(toggle, controls);

  function setVisible(visible) {
    if (!visible) releaseAllInputs();
    controls.hidden = !visible;
    toggle.textContent = visible ? "Hide controls" : "Touch controls";
    toggle.setAttribute("aria-expanded", String(visible));
  }

  function dispatchKey(type, definition) {
    window.dispatchEvent(
      new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        key: definition.key,
        code: definition.code,
        location: 0,
        repeat: false,
        keyCode: definition.keyCode,
        which: definition.keyCode,
      })
    );
  }

  function setKey(code, source, isPressed) {
    const definition = keyDefinitions[code];
    if (!definition) return;

    let sources = keySources.get(code);
    if (isPressed) {
      if (!sources) {
        sources = new Set();
        keySources.set(code, sources);
      }
      if (sources.has(source)) return;
      sources.add(source);
      if (sources.size === 1) dispatchKey("keydown", definition);
      return;
    }

    if (!sources || !sources.delete(source)) return;
    if (sources.size === 0) {
      keySources.delete(code);
      dispatchKey("keyup", definition);
    }
  }

  function getGameCanvas() {
    return gameFrame.querySelector("canvas");
  }

  function getMouseMask() {
    let buttons = 0;
    for (const [button, sources] of mouseSources) {
      if (sources.size > 0) buttons |= 1 << button;
    }
    return buttons;
  }

  // The game listens for mouse movement on its canvas, so touch drags enter that same input path.
  function dispatchMouse(type, button = 0, point = {}, movementX = 0, movementY = 0) {
    const canvas = getGameCanvas();
    if (!canvas) return;

    const bounds = canvas.getBoundingClientRect();
    const clientX = Number.isFinite(point.clientX)
      ? point.clientX
      : bounds.left + bounds.width / 2;
    const clientY = Number.isFinite(point.clientY)
      ? point.clientY
      : bounds.top + bounds.height / 2;

    canvas.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        button,
        buttons: getMouseMask(),
        clientX,
        clientY,
        movementX,
        movementY,
      })
    );
  }

  function setMouseButton(button, source, isPressed, point = {}) {
    let sources = mouseSources.get(button);
    if (isPressed) {
      if (!sources) {
        sources = new Set();
        mouseSources.set(button, sources);
      }
      if (sources.has(source)) return;
      const wasPressed = sources.size > 0;
      sources.add(source);
      if (!wasPressed) dispatchMouse("mousedown", button, point);
      return;
    }

    if (!sources || !sources.delete(source)) return;
    if (sources.size === 0) {
      mouseSources.delete(button);
      dispatchMouse("mouseup", button, point);
    }
  }

  function handleButtonPointerDown(event) {
    if (event.button !== 0 || activeButtons.has(event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const source = `control:${event.pointerId}`;
    const key = button.dataset.key;
    const mouseButton = button.dataset.mouseButton;
    const release = key
      ? () => setKey(key, source, false)
      : () => setMouseButton(Number(mouseButton), source, false);

    if (key) setKey(key, source, true);
    else setMouseButton(Number(mouseButton), source, true);

    button.classList.add("is-pressed");
    button.setAttribute("aria-pressed", "true");
    activeButtons.set(event.pointerId, { button, release });
    try {
      button.setPointerCapture(event.pointerId);
    } catch {}
  }

  function releaseButtonPointer(event) {
    const active = activeButtons.get(event.pointerId);
    if (!active) return;
    activeButtons.delete(event.pointerId);
    active.release();
    active.button.classList.remove("is-pressed");
    active.button.setAttribute("aria-pressed", "false");
  }

  function beginLook(event) {
    if (event.button !== 0 || lookPointer) return;
    event.preventDefault();
    event.stopPropagation();
    lookPointer = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      distance: 0,
      startedAt: performance.now(),
      dragged: false,
    };
    try {
      lookPad.setPointerCapture(event.pointerId);
    } catch {}
  }

  function moveLook(event) {
    if (!lookPointer || lookPointer.pointerId !== event.pointerId) return;
    event.preventDefault();

    const deltaX = event.clientX - lookPointer.lastX;
    const deltaY = event.clientY - lookPointer.lastY;
    lookPointer.lastX = event.clientX;
    lookPointer.lastY = event.clientY;
    lookPointer.distance += Math.hypot(deltaX, deltaY);
    if (lookPointer.distance > 5) lookPointer.dragged = true;
    if (!lookPointer.dragged || (!deltaX && !deltaY)) return;

    dispatchMouse(
      "mousemove",
      0,
      { clientX: event.clientX, clientY: event.clientY },
      deltaX * 1.35,
      deltaY * 1.35
    );
  }

  function endLook(event) {
    if (!lookPointer || lookPointer.pointerId !== event.pointerId) return;
    event.preventDefault();

    const wasTap =
      !lookPointer.dragged && performance.now() - lookPointer.startedAt < 550;
    lookPointer = null;
    if (wasTap) {
      const point = { clientX: event.clientX, clientY: event.clientY };
      const source = `look-tap:${event.pointerId}`;
      setMouseButton(0, source, true, point);
      setMouseButton(0, source, false, point);
    }
  }

  function releaseAllInputs() {
    for (const pointerId of Array.from(activeButtons.keys())) {
      releaseButtonPointer({ pointerId });
    }
    lookPointer = null;

    for (const [code, sources] of Array.from(keySources.entries())) {
      for (const source of Array.from(sources)) setKey(code, source, false);
    }
    for (const [button, sources] of Array.from(mouseSources.entries())) {
      for (const source of Array.from(sources)) {
        setMouseButton(button, source, false);
      }
    }
  }

  lookPad.addEventListener("pointerdown", beginLook);
  lookPad.addEventListener("pointermove", moveLook);
  window.addEventListener("pointerup", (event) => {
    releaseButtonPointer(event);
    endLook(event);
  }, true);
  window.addEventListener("pointercancel", (event) => {
    releaseButtonPointer(event);
    if (lookPointer && lookPointer.pointerId === event.pointerId) {
      lookPointer = null;
    }
  }, true);
  window.addEventListener("blur", releaseAllInputs);
  window.addEventListener("pagehide", releaseAllInputs);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAllInputs();
  });
  document.addEventListener("contextmenu", (event) => {
    if (controls.contains(event.target)) event.preventDefault();
  });

  toggle.addEventListener("click", () => {
    manuallyToggled = true;
    setVisible(controls.hidden);
  });
  const updateForViewport = (event) => {
    if (!manuallyToggled) setVisible(event.matches);
  };
  if (compactViewport.addEventListener) {
    compactViewport.addEventListener("change", updateForViewport);
  } else {
    compactViewport.addListener(updateForViewport);
  }

  setVisible(compactViewport.matches);
})();

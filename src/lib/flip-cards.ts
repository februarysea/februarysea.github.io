export {};

type CardFace = "front" | "back";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const controllers = new Map<HTMLElement, { refresh: () => void; destroy: () => void }>();
let dialogObserver: MutationObserver | undefined;
let pageHidden = false;
let keyboardNavigation = true;

function refreshFlipCards() {
  controllers.forEach(({ refresh }) => refresh());
}

function initFlipCards() {
  document.querySelectorAll<HTMLElement>("[data-flip-card]").forEach((container) => {
    if (controllers.has(container)) return;
    const inner = container.querySelector<HTMLElement>("[data-flip-inner]");
    const front = container.querySelector<HTMLElement>('[data-flip-side="front"]');
    const back = container.querySelector<HTMLElement>('[data-flip-side="back"]');
    if (!inner || !front || !back) return;

    const events = new AbortController();
    let currentFace: CardFace = container.dataset.manualFace === "back" ? "back" : "front";
    let inView = false;
    let disposed = false;
    let timer: number | undefined;
    let timerStartedAt = 0;
    let remainingMs = durationFor(currentFace);
    let pointerInside = container.matches(":hover");

    container.dataset.flipReady = "true";
    container.querySelectorAll<HTMLButtonElement>("[data-flip-to]").forEach((button) => {
      button.hidden = false;
    });

    const showFace = (face: CardFace, moveFocus = false) => {
      const shown = face === "front" ? front : back;
      const hidden = face === "front" ? back : front;
      shown.inert = false;
      shown.setAttribute("aria-hidden", "false");
      container.dataset.manualFace = face;
      inner.classList.toggle("flipped", face === "back");
      // Only an explicit flip moves focus; an idle preview never takes focus.
      if (moveFocus) {
        shown.querySelector<HTMLButtonElement>("[data-flip-to]")?.focus({ preventScroll: true });
      } else if (hidden.contains(document.activeElement)) {
        // A pointer click must not leave its old button focused on an inert face.
        (document.activeElement as HTMLElement | null)?.blur();
      }
      hidden.inert = true;
      hidden.setAttribute("aria-hidden", "true");
      if (container.hasAttribute("aria-labelledby")) {
        const heading = shown.querySelector<HTMLElement>("h2[id]");
        if (heading) container.setAttribute("aria-labelledby", heading.id);
      }
      container.dispatchEvent(new CustomEvent("card-flip"));
    };

    function durationFor(face: CardFace) {
      return face === "front" ? 8000 + Math.random() * 6000 : 6000 + Math.random() * 4000;
    }

    function pauseTimer() {
      if (timer === undefined) return;
      window.clearTimeout(timer);
      timer = undefined;
      remainingMs = Math.max(0, remainingMs - (performance.now() - timerStartedAt));
    }

    function canAutoFlip() {
      const focused = document.activeElement;
      // Pointer-created focus must not keep a card paused after the pointer exits.
      const readingWithKeyboard = focused instanceof Element && container.contains(focused)
        && ((keyboardNavigation && focused.matches(":focus-visible"))
          || focused.matches("input, textarea, select")
          || (focused instanceof HTMLElement && focused.isContentEditable));
      return !disposed && inView && !document.hidden && !pageHidden
        && !reducedMotion.matches && !readingWithKeyboard && !pointerInside
        && !document.querySelector("dialog[open]");
    }

    function flipTo(face: CardFace, moveFocus = false) {
      pauseTimer();
      currentFace = face;
      // Every newly shown face receives a fresh countdown, even while paused.
      remainingMs = durationFor(face);
      showFace(face, moveFocus);
      refresh();
    }

    function refresh() {
      if (!canAutoFlip()) {
        pauseTimer();
        return;
      }
      if (timer !== undefined) return;
      timerStartedAt = performance.now();
      timer = window.setTimeout(() => {
        timer = undefined;
        remainingMs = 0;
        if (!canAutoFlip()) return;
        flipTo(currentFace === "front" ? "back" : "front");
      }, remainingMs);
    }

    container.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>("[data-flip-to]");
      if (!button || button.closest("[data-flip-card]") !== container) return;
      const face = button.dataset.flipTo;
      if (face !== "front" && face !== "back") return;
      // Explicit buttons reset the new face's timer; hover still keeps it paused.
      // Keyboard activation moves focus to the matching control on the new face.
      flipTo(face, event.detail === 0);
    }, { signal: events.signal });

    const isWithinCard = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      return event.clientX >= bounds.left && event.clientX <= bounds.right
        && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    };

    function leaveHover() {
      if (!pointerInside) return;
      pointerInside = false;
      flipTo(currentFace === "front" ? "back" : "front");
    }

    container.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch" || pointerInside || !isWithinCard(event)) return;
      pointerInside = true;
      flipTo(currentFace === "front" ? "back" : "front");
    }, { signal: events.signal });
    container.addEventListener("pointerleave", (event) => {
      // 3D faces can change hit-testing without the pointer leaving the card.
      if (event.pointerType !== "touch" && !isWithinCard(event)) leaveHover();
    }, { signal: events.signal });
    window.addEventListener("pointermove", (event) => {
      // Also catch a real exit after a transform-generated boundary event.
      if (pointerInside && event.pointerType !== "touch" && !isWithinCard(event)) leaveHover();
    }, { signal: events.signal });

    container.addEventListener("focusin", refresh, { signal: events.signal });
    container.addEventListener("focusout", () => queueMicrotask(refresh), { signal: events.signal });

    const visibility = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      refresh();
    });
    visibility.observe(container);

    controllers.set(container, {
      refresh,
      destroy: () => {
        disposed = true;
        pauseTimer();
        events.abort();
        visibility.disconnect();
        delete container.dataset.flipReady;
      },
    });
  });

  if (!dialogObserver) {
    dialogObserver = new MutationObserver(refreshFlipCards);
    dialogObserver.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["open"] });
  }
}

// Track the input that created focus, rather than treating every focused day
// as keyboard reading. Capture runs before the card's click/focus handlers.
document.addEventListener("pointerdown", () => {
  keyboardNavigation = false;
  refreshFlipCards();
}, { capture: true });
document.addEventListener("keydown", () => {
  keyboardNavigation = true;
  refreshFlipCards();
}, { capture: true });

initFlipCards();
document.addEventListener("astro:page-load", initFlipCards);
document.addEventListener("visibilitychange", refreshFlipCards);
reducedMotion.addEventListener("change", refreshFlipCards);
window.addEventListener("pagehide", () => {
  pageHidden = true;
  refreshFlipCards();
});
window.addEventListener("pageshow", () => {
  pageHidden = false;
  initFlipCards();
  refreshFlipCards();
});
document.addEventListener("astro:before-swap", () => {
  controllers.forEach(({ destroy }) => destroy());
  controllers.clear();
  dialogObserver?.disconnect();
  dialogObserver = undefined;
});

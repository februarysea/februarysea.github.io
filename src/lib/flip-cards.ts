export {};

type CardFace = "front" | "back";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const controllers = new Map<HTMLElement, { refresh: () => void; destroy: () => void }>();
let dialogObserver: MutationObserver | undefined;
let pageHidden = false;

function refreshFlipCards() {
  controllers.forEach(({ refresh }) => refresh());
}

function initFlipCards() {
  document.querySelectorAll<HTMLElement>("[data-flip-card]").forEach((container, index) => {
    if (controllers.has(container)) return;
    const inner = container.querySelector<HTMLElement>("[data-flip-inner]");
    const front = container.querySelector<HTMLElement>('[data-flip-side="front"]');
    const back = container.querySelector<HTMLElement>('[data-flip-side="back"]');
    if (!inner || !front || !back) return;

    const events = new AbortController();
    const pauseOnHover = container.hasAttribute("data-flip-pause-hover");
    let restingFace: CardFace = container.dataset.manualFace === "back" ? "back" : "front";
    let previewing = false;
    let hasPreviewed = false;
    let inView = false;
    let disposed = false;
    let timer: number | undefined;
    let interactionUntil = 0;
    let pointerInside = pauseOnHover && container.matches(":hover");
    let hoverReturn: { face: CardFace; interactionUntil: number } | undefined;

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

    function clearTimer() {
      window.clearTimeout(timer);
      timer = undefined;
    }

    function canPreview() {
      const focused = document.activeElement;
      const readingWithKeyboard = focused instanceof Element && container.contains(focused)
        && (pauseOnHover || focused.matches(":focus-visible, input, textarea, select")
          || (focused instanceof HTMLElement && focused.isContentEditable));
      return !disposed && inView && !document.hidden && !pageHidden
        && !reducedMotion.matches && !readingWithKeyboard && !(pauseOnHover && pointerInside)
        && !document.querySelector("dialog[open]");
    }

    function refresh() {
      if (!canPreview()) {
        clearTimer();
        return;
      }
      if (timer !== undefined) return;
      // Let the first staggered peek make the interaction discoverable, then settle.
      const idleDelay = previewing ? 3500 + Math.random() * 1500
        : hasPreviewed ? 8000 + Math.random() * 6000
          : 3000 + (index * 550) % 2600 + Math.random() * 400;
      const readingTime = interactionUntil - Date.now();
      const delay = readingTime > 0 ? readingTime : idleDelay;
      timer = window.setTimeout(() => {
        timer = undefined;
        if (!canPreview()) return;
        // The idle cycle has taken over; leaving later must not rewind it.
        hoverReturn = undefined;
        previewing = !previewing;
        hasPreviewed = true;
        showFace(previewing ? (restingFace === "front" ? "back" : "front") : restingFace);
        refresh();
      }, delay);
    }

    container.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>("[data-flip-to]");
      if (!button || button.closest("[data-flip-card]") !== container) return;
      const face = button.dataset.flipTo;
      if (face !== "front" && face !== "back") return;
      clearTimer();
      hoverReturn = undefined;
      interactionUntil = Date.now() + 10000;
      restingFace = face;
      previewing = false;
      // Explicit pointer flips give ten seconds to read. Cards with hover
      // pausing also wait until the pointer and reading focus have left.
      showFace(face, event.detail === 0);
      refresh();
    }, { signal: events.signal });

    const isWithinCard = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      return event.clientX >= bounds.left && event.clientX <= bounds.right
        && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    };

    function leaveHover() {
      pointerInside = false;
      const previous = hoverReturn;
      hoverReturn = undefined;
      if (!previous) {
        refresh();
        return;
      }
      clearTimer();
      interactionUntil = previous.interactionUntil;
      // Never hide a face that acquired keyboard or editable-field focus.
      if (canPreview()) {
        previewing = previous.face !== restingFace;
        showFace(previous.face);
      }
      refresh();
    }

    container.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch" || pointerInside || !isWithinCard(event)) return;
      pointerInside = true;
      if (pauseOnHover) {
        clearTimer();
        return;
      }
      if (!canPreview()) return;
      clearTimer();
      const visibleFace: CardFace = container.dataset.manualFace === "back" ? "back" : "front";
      hoverReturn = { face: visibleFace, interactionUntil };
      const nextFace = visibleFace === "front" ? "back" : "front";
      previewing = nextFace !== restingFace;
      hasPreviewed = true;
      interactionUntil = Date.now() + 10000;
      showFace(nextFace);
      refresh();
    }, { signal: events.signal });
    container.addEventListener("pointerleave", (event) => {
      // 3D faces can change hit-testing without the pointer leaving the card.
      if (event.pointerType !== "touch" && !isWithinCard(event)) leaveHover();
    }, { signal: events.signal });
    window.addEventListener("pointermove", (event) => {
      // Also catch a real exit after a transform-generated boundary event.
      if (pointerInside && event.pointerType !== "touch" && !isWithinCard(event)) leaveHover();
    }, { signal: events.signal });

    container.addEventListener("pointerdown", () => {
      if (!pauseOnHover) return;
      clearTimer();
      interactionUntil = Date.now() + 10000;
      refresh();
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
        clearTimer();
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

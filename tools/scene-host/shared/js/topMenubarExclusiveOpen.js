export function initTopMenubarExclusiveOpen(root = document, onOutsidePointerDown) {
  const menubars = Array.from(root.querySelectorAll(".topMenubar"));
  const menus = Array.from(root.querySelectorAll(".topMenubar > .topMenu"));

  function closeHoverMenus(scope) {
    scope.querySelectorAll?.(".topMenubar > .topMenu[open][data-hover-open='true']").forEach((details) => {
      details.removeAttribute("open");
      delete details.dataset.hoverOpen;
    });
  }

  menus.forEach((details) => {
    const summary = details.querySelector(":scope > summary");
    details.addEventListener("toggle", () => {
      if (!details.open) {
        delete details.dataset.hoverOpen;
        return;
      }
      root.querySelectorAll(".topMenubar > .topMenu[open]").forEach((other) => {
        if (other !== details) {
          other.removeAttribute("open");
        }
      });
    });

    details.addEventListener("pointerenter", () => {
      if (!details.open) {
        details.dataset.hoverOpen = "true";
        details.setAttribute("open", "");
      }
    });

    summary?.addEventListener("pointerdown", (event) => {
      if (details.open && details.dataset.hoverOpen === "true") {
        event.preventDefault();
        delete details.dataset.hoverOpen;
      }
    });
  });

  menubars.forEach((menubar) => {
    menubar.addEventListener("pointerleave", () => {
      closeHoverMenus(menubar.ownerDocument || root);
    });
  });

  if (typeof onOutsidePointerDown === "function") {
    root.addEventListener(
      "pointerdown",
      (event) => {
        if (!event.target.closest(".topMenubar")) {
          closeHoverMenus(root);
          onOutsidePointerDown(event);
        }
      },
      true
    );
  }
}

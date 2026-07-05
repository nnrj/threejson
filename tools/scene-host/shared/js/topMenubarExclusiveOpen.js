export function initTopMenubarExclusiveOpen(root = document, onOutsidePointerDown) {
  root.querySelectorAll(".topMenubar > .topMenu").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (!details.open) {
        return;
      }
      root.querySelectorAll(".topMenubar > .topMenu[open]").forEach((other) => {
        if (other !== details) {
          other.removeAttribute("open");
        }
      });
    });
  });
  if (typeof onOutsidePointerDown === "function") {
    root.addEventListener(
      "pointerdown",
      (event) => {
        if (!event.target.closest(".topMenubar")) {
          onOutsidePointerDown(event);
        }
      },
      true
    );
  }
}

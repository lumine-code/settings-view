// Chromium lays out a newly shown scroll container when focus checks whether
// its target must be scrolled into view. Temporarily excluding unrelated heavy
// content keeps that layout out of the navigation handler. Restoring display in
// the same task means the intermediate state is never painted.
module.exports = function focusWithHiddenContent(target, contentElements) {
  const elements = [
    ...new Set(
      Array.from(contentElements || []).filter(
        (element) => element && element !== target && !element.contains(target),
      ),
    ),
  ];
  const displays = elements.map((element) => element.style.display);
  for (const element of elements) element.style.display = "none";
  try {
    target.focus({ preventScroll: true });
  } finally {
    elements.forEach((element, index) => {
      element.style.display = displays[index];
    });
  }
};

const messages = new WeakMap();

// Query and configuration controls keep the complete draft in their TextBuffer.
// A null result explicitly stops parsing, searching or committing that draft.
module.exports = function readInput(editor, limit = 4096, label = "Query") {
  const length = editor.getBuffer?.()?.getLength?.();
  let text;
  if (length == null) text = editor.getText();
  const element = editor.element ?? editor.getElement?.();
  if ((length ?? text.length) > limit) {
    if (element) {
      element.setAttribute("data-input-too-large", "");
      element.setAttribute("aria-invalid", "true");
      let message = messages.get(element);
      if (!message) {
        message = document.createElement("div");
        message.className = "settings-input-budget-message text-warning";
        message.setAttribute("role", "status");
        messages.set(element, message);
      }
      message.textContent = `${label} exceeds ${limit} UTF-16 units. Shorten it to resume; the draft has been preserved.`;
      element.after(message);
    }
    return null;
  }
  if (element?.hasAttribute("data-input-too-large")) {
    element.removeAttribute("data-input-too-large");
    element.removeAttribute("aria-invalid");
    messages.get(element)?.remove();
    messages.delete(element);
  }
  return text ?? editor.getText();
};

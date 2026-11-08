const scrollCommands = new Set([
  "core:move-up",
  "core:move-down",
  "core:page-up",
  "core:page-down",
  "core:move-to-top",
  "core:move-to-bottom",
]);

module.exports = function stopCommandPropagation(commands) {
  return Object.fromEntries(
    Object.entries(commands).map(([name, listener]) => {
      const callback = typeof listener === "function" ? listener : listener.didDispatch;
      const didDispatch = function (event) {
        event.stopPropagation();
        if (scrollCommands.has(name)) lumine.scrollbars.reveal(event.currentTarget);
        return callback.call(this, event);
      };
      return [name, typeof listener === "function" ? didDispatch : { ...listener, didDispatch }];
    }),
  );
};

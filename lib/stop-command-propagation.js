module.exports = function stopCommandPropagation(commands) {
  return Object.fromEntries(
    Object.entries(commands).map(([name, listener]) => {
      const callback = typeof listener === "function" ? listener : listener.didDispatch;
      const didDispatch = function (event) {
        event.stopPropagation();
        return callback.call(this, event);
      };
      return [name, typeof listener === "function" ? didDispatch : { ...listener, didDispatch }];
    }),
  );
};

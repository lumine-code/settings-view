// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-javascript", "jupyter-repl", "jupyter-view", "jupyter-explorer"],
  viewport: { width: 1100, height: 730 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("editing/signal.js");
    await lumine.project.setPaths([fixture("editing")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Find installed Jupyter packages in the package manager.",
      timeout: 60000,
      async run(context) {
        const { lumine } = context;
        {
          await lumine.workspace.open("lumine://config/packages");
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        {
          const el = [...document.querySelectorAll(".settings-view lumine-text-editor[mini]")].find(
            (e) => e.getModel().getPlaceholderText() === "Filter packages by name",
          );
          if (!el) throw Error("No package filter");
          el.getModel().setText("jupyter");
        }
      },
      ready() {
        return Boolean(
          document.querySelector(".settings-view")?.innerText.includes("jupyter-view"),
        );
      },
    },
  ],
  async cleanup() {},
};

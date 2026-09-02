const { CompositeDisposable } = require("lumine");

// View to display the grammars that a package has registered.
module.exports = class PackageGrammarsView {
  constructor(packageName) {
    this.element = document.createElement("section");
    this.element.classList.add("package-grammars");

    this.grammarSettings = document.createElement("div");
    this.element.appendChild(this.grammarSettings);

    this.disposables = new CompositeDisposable();
    this.packageName = packageName;
    this.addGrammars();
    this.disposables.add(lumine.grammars.onDidAddGrammar(() => this.addGrammars()));
    this.disposables.add(lumine.grammars.onDidUpdateGrammar(() => this.addGrammars()));
    this.disposables.add(lumine.grammars.onDidRemoveGrammar(() => this.addGrammars()));
  }

  destroy() {
    this.disposables.dispose();
    this.element.remove();
  }

  getPackageGrammars() {
    const grammars = lumine.grammars.getGrammars() ?? [];
    return grammars
      .filter(
        (grammar) => grammar.packageName === this.packageName && grammar.name && grammar.scopeName,
      )
      .sort(function (grammar1, grammar2) {
        const name1 = grammar1.name || grammar1.scopeName || "";
        const name2 = grammar2.name || grammar2.scopeName || "";
        return name1.localeCompare(name2) || grammar1.scopeName.localeCompare(grammar2.scopeName);
      });
  }

  elementForGrammar(grammar) {
    const panel = document.createElement("section");
    panel.classList.add("section", "settings-panel");
    const panelContainer = document.createElement("div");
    panelContainer.classList.add("section-container");
    panel.appendChild(panelContainer);
    const heading = document.createElement("div");
    heading.classList.add("block", "section-heading", "icon", "icon-puzzle");
    heading.textContent = `${grammar.name} Grammar`;
    panelContainer.appendChild(heading);

    const container = document.createElement("div");
    container.classList.add("native-key-bindings", "text");
    container.tabIndex = -1;

    const grammarScope = document.createElement("div");
    grammarScope.classList.add("grammar-scope");

    const scopeStrong = document.createElement("strong");
    scopeStrong.textContent = "Scope: ";
    grammarScope.appendChild(scopeStrong);

    const scopeSpan = document.createElement("span");
    scopeSpan.textContent = grammar.scopeName != null ? grammar.scopeName : "";
    grammarScope.appendChild(scopeSpan);
    container.appendChild(grammarScope);

    const grammarFileTypes = document.createElement("div");
    grammarFileTypes.classList.add("grammar-filetypes");

    const fileTypesStrong = document.createElement("strong");
    fileTypesStrong.textContent = "File Types: ";
    grammarFileTypes.appendChild(fileTypesStrong);

    const fileTypes = grammar.fileTypes || [];
    const fileTypesSpan = document.createElement("span");
    fileTypesSpan.textContent = fileTypes.join(", ");
    grammarFileTypes.appendChild(fileTypesSpan);
    container.appendChild(grammarFileTypes);

    panelContainer.appendChild(container);
    return panel;
  }

  addGrammars() {
    this.grammarSettings.innerHTML = "";
    for (let grammar of this.getPackageGrammars()) {
      this.grammarSettings.appendChild(this.elementForGrammar(grammar));
    }
  }
};

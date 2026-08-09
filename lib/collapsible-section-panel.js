const { Disposable } = require("lumine");

module.exports = class CollapsibleSectionPanel {
  notHiddenCardsLength(sectionElement) {
    return sectionElement.querySelectorAll(".package-card:not(.hidden)").length;
  }

  updateSectionCount(headerElement, countElement, packageCount, totalCount) {
    if (totalCount != null) {
      countElement.textContent = `${packageCount}/${totalCount}`;
    } else {
      countElement.textContent = packageCount;
    }

    if (packageCount > 0) {
      headerElement.classList.add("has-items");
    } else {
      // A section listing nothing is spaced like a collapsed one. The
      // container's bottom gap separates the last card from the next sticky
      // heading, and an empty section has no card to separate.
      headerElement.parentElement.classList.add("empty");
    }
  }

  updateSectionCounts() {
    this.resetSectionHasItems();

    const filterText = this.refs.filterEditor.getText();
    if (filterText === "") {
      this.updateUnfilteredSectionCounts();
    } else {
      this.updateFilteredSectionCounts();
    }
  }

  handleEvents() {
    const handler = (e) => {
      const target = e.target.closest(".sub-section .has-items");
      if (target) {
        target.parentNode.classList.toggle("collapsed");
      }
    };
    this.element.addEventListener("click", handler);
    return new Disposable(() => this.element.removeEventListener("click", handler));
  }

  resetCollapsibleSections(headerSections) {
    for (const headerSection of headerSections) {
      this.resetCollapsibleSection(headerSection);
    }
  }

  resetCollapsibleSection(headerSection) {
    headerSection.classList.remove("has-items");
    headerSection.parentElement.classList.remove("empty");
  }
};

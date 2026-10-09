let SettingsView = null;
let settingsView = null;
let statusViewIcon = null;
let packageUpdatesStatusView = null;

let PackageManager = null;
let packageManager = null;
let statusOwner = null;
let subscriptions = null;
let snippetsServices = [];

const recentSettings = require("./recent-settings");
const etch = require("@lumine-code/etch");
const { CompositeDisposable, Disposable } = require("lumine");

// Etch holds its scheduler per copy of the library, and this package resolves
// its own copy — so the assignment the editor makes on core's copy never
// reaches it. Point it at the view registry before anything renders, or this
// package's DOM writes land on an animation frame of their own alongside the
// editor's and force a synchronous reflow.
etch.setScheduler(lumine.views);

const SnippetsProvider = {
  getSnippets() {
    return lumine.config.scopedSettingsStore.propertySets;
  },
};
const fallbackGetSnippets = SnippetsProvider.getSnippets;
const fallbackGetUserSnippetsPath = SnippetsProvider.getUserSnippetsPath;

function updateSnippetsProvider() {
  const snippets = snippetsServices.at(-1)?.snippets;
  SnippetsProvider.getSnippets =
    typeof snippets?.getUnparsedSnippets === "function"
      ? snippets.getUnparsedSnippets.bind(snippets)
      : fallbackGetSnippets;
  if (typeof snippets?.getUserSnippetsPath === "function") {
    SnippetsProvider.getUserSnippetsPath = snippets.getUserSnippetsPath.bind(snippets);
  } else if (fallbackGetUserSnippetsPath) {
    SnippetsProvider.getUserSnippetsPath = fallbackGetUserSnippetsPath;
  } else {
    delete SnippetsProvider.getUserSnippetsPath;
  }
}

const CONFIG_URI = "lumine://config";

function getPackageManager() {
  if (PackageManager == null) PackageManager = require("./package-manager");
  if (packageManager == null) {
    // The status-bar provider is available before Settings is opened. Do not
    // construct the package manager just to render a usually hidden counter.
    packageManager = new PackageManager();
    attachPackageUpdatesStatusView(packageManager);
  }
  return packageManager;
}

function attachPackageUpdatesStatusView(manager) {
  if (manager != null) refreshStatusViews(statusOwner);
}

function statusIsLive(owner) {
  return (
    owner != null &&
    statusOwner === owner &&
    !owner.retired &&
    subscriptions === owner.subscriptions
  );
}

function latestStatusRecord(owner) {
  let record = null;
  for (const edge of owner.edges) record = edge.record;
  return record;
}

function refreshStatusViews(owner) {
  if (!statusIsLive(owner)) return;
  owner.pending = true;
  if (owner.rebinding) return;
  owner.rebinding = true;
  try {
    while (owner.pending && statusIsLive(owner)) {
      owner.pending = false;
      const record = latestStatusRecord(owner);
      if (owner.current !== record) {
        const icon = statusViewIcon,
          updates = packageUpdatesStatusView;
        statusViewIcon = packageUpdatesStatusView = null;
        owner.current = record;
        icon?.destroy();
        updates?.destroy();
      }
      if (!statusIsLive(owner)) return;
      if (!record || latestStatusRecord(owner) !== record) {
        owner.pending = !!latestStatusRecord(owner);
        continue;
      }
      const current = () =>
        statusIsLive(owner) && owner.current === record && latestStatusRecord(owner) === record;
      if (packageManager != null && packageUpdatesStatusView == null) {
        const UpdatesView = require("./package-updates-status-view");
        const view = new UpdatesView(record.bar, packageManager);
        if (current()) view.attach();
        if (!current()) {
          view.destroy();
          owner.pending = true;
          continue;
        }
        packageUpdatesStatusView = view;
      }
      if (
        statusViewIcon == null &&
        lumine.config.get("settings-view.showSettingsIconInStatusBar")
      ) {
        const IconView = require("./settings-icon-status-view");
        const view = new IconView(record.bar);
        if (current()) view.attach();
        if (!current()) {
          view.destroy();
          owner.pending = true;
          continue;
        }
        statusViewIcon = view;
      }
    }
  } finally {
    owner.rebinding = false;
  }
}

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "settings-view",
      tips: [
        "You can install packages, themes, and customize your editor in Settings with {{ 'settings-view:open' | keystroke }}",
      ],
    };
  },

  handleURI(parsed) {
    switch (parsed.pathname) {
      case "/show-package":
        this.showPackage(parsed.query.package);
    }
  },

  showPackage(packageName) {
    lumine.workspace.open(`lumine://config/packages/${packageName}`);
  },

  // Restoring a window deserializes the Settings pane item before packages are
  // activated, so the recently-opened list has to be read here rather than in
  // `activate` — otherwise the Search panel paints an empty list on exactly the
  // session where it was left open.
  initialize(state) {
    recentSettings.load(state.recentSettings);
  },

  serialize() {
    return { recentSettings: recentSettings.serialize() };
  },

  activate() {
    snippetsServices = [];
    updateSnippetsProvider();
    subscriptions?.dispose();
    subscriptions = new CompositeDisposable();
    statusOwner = {
      subscriptions,
      records: new Map(),
      edges: new Set(),
      current: null,
      retired: false,
      pending: false,
      rebinding: false,
    };
    subscriptions.add(
      lumine.workspace.addOpener((uri) => {
        if (uri.startsWith(CONFIG_URI)) {
          if (settingsView == null || settingsView.destroyed) {
            settingsView = this.createSettingsView({ uri });
          } else {
            const pane = lumine.workspace.paneForItem(settingsView);
            if (pane) pane.activate();
          }

          settingsView.showPanelForURI(uri);
          return settingsView;
        }
      }),
    );

    subscriptions.add(
      lumine.commands.add("lumine-workspace", {
        "settings-view:open"() {
          lumine.workspace.open(CONFIG_URI);
        },
        "settings-view:core": {
          description: "Open the settings that apply to the editor as a whole.",
          didDispatch() {
            lumine.workspace.open(`${CONFIG_URI}/core`);
          },
        },
        "settings-view:editor": {
          description: "Open the settings that apply to every text editor.",
          didDispatch() {
            lumine.workspace.open(`${CONFIG_URI}/editor`);
          },
        },
        "settings-view:show-keybindings": {
          description: "List every keybinding the editor and its packages define.",
          didDispatch() {
            lumine.workspace.open(`${CONFIG_URI}/keybindings`);
          },
        },
        "settings-view:install-packages-and-themes": {
          description: "Search the catalogue for a package or theme to install.",
          didDispatch() {
            lumine.workspace.open(`${CONFIG_URI}/install`);
          },
        },
        // Two names for the one page: the themes list is where a theme is both
        // looked at and removed, so both carry the one sentence.
        "settings-view:view-installed-themes": {
          description: "Open the list of themes installed on this machine.",
          didDispatch() {
            lumine.workspace.open(`${CONFIG_URI}/themes`);
          },
        },
        "settings-view:uninstall-themes": {
          description: "Open the list of themes installed on this machine.",
          didDispatch() {
            lumine.workspace.open(`${CONFIG_URI}/themes`);
          },
        },
        "settings-view:use-light-mode": {
          description: "Keep the light theme, whatever the system is set to.",
          didDispatch() {
            lumine.config.set("theme.mode", "light");
          },
        },
        "settings-view:use-dark-mode": {
          description: "Keep the dark theme, whatever the system is set to.",
          didDispatch() {
            lumine.config.set("theme.mode", "dark");
          },
        },
        "settings-view:use-system-mode": {
          description: "Follow the operating system's light or dark setting.",
          didDispatch() {
            lumine.config.set("theme.mode", "system");
          },
        },
        "settings-view:view-installed-packages": {
          description: "Open the list of packages installed on this machine.",
          didDispatch() {
            lumine.workspace.open(`${CONFIG_URI}/packages`);
          },
        },
        "settings-view:uninstall-packages": {
          description: "Open the list of packages installed on this machine.",
          didDispatch() {
            lumine.workspace.open(`${CONFIG_URI}/packages`);
          },
        },
        "settings-view:check-updates": {
          description: "Look for newer releases of the installed packages.",
          didDispatch() {
            lumine.workspace.open(`${CONFIG_URI}/update`);
          },
        },
        "settings-view:clear-recent-settings": {
          description: "Forget which settings were changed most recently.",
          didDispatch() {
            recentSettings.clear();
          },
        },
      }),
    );

    if (process.platform === "win32" && require("lumine").WinShell != null) {
      subscriptions.add(
        lumine.commands.add("lumine-workspace", {
          "settings-view:system": {
            description: "Open the settings for the Windows shell integration.",
            didDispatch() {
              lumine.workspace.open(`${CONFIG_URI}/system`);
            },
          },
        }),
      );
    }
  },

  deactivate() {
    const owner = statusOwner;
    statusOwner = null;
    if (owner) {
      owner.retired = true;
      owner.edges.clear();
      for (const record of owner.records.values()) record.bar = null;
      owner.records.clear();
      owner.current = null;
    }
    const oldSubscriptions = subscriptions,
      oldSettingsView = settingsView;
    const updates = packageUpdatesStatusView,
      icon = statusViewIcon;
    subscriptions = null;
    settingsView = null;
    packageUpdatesStatusView = null;
    statusViewIcon = null;
    packageManager = null;
    oldSubscriptions?.dispose();
    oldSettingsView?.destroy();
    updates?.destroy();
    icon?.destroy();
    let notification;
    notification = lumine.notifications.addWarning(
      "Warning! You have disabled the settings-view package. To enable it again, edit [`config.json`](https://github.com/lumine-code/lumine#configuration) and remove `settings-view` from `core.disabledPackages`.",
      {
        dismissable: true,
        buttons: [
          {
            text: "Enable Settings View",
            onDidClick() {
              Promise.resolve(lumine.packages.enablePackage("settings-view")).catch((error) => {
                lumine.notifications.addError("Unable to enable Settings View", {
                  detail: error.message,
                  dismissable: true,
                });
              });
              notification.dismiss();
            },
          },
        ],
      },
    );
  },

  consumeStatusBar(statusBar) {
    const owner = statusOwner;
    if (!statusIsLive(owner)) return new Disposable();
    let record = owner.records.get(statusBar);
    if (!record) {
      record = { bar: statusBar, references: 0 };
      owner.records.set(statusBar, record);
    }
    record.references++;
    const edge = { record };
    owner.edges.add(edge);
    const lease = new Disposable(() => {
      if (!owner.edges.delete(edge)) return;
      if (--record.references === 0) {
        owner.records.delete(statusBar);
        record.bar = null;
      }
      owner.subscriptions.remove(lease);
      refreshStatusViews(owner);
    });
    owner.subscriptions.add(lease);
    refreshStatusViews(owner);
    return lease;
  },

  consumeSnippets(snippets) {
    const entry = { snippets };
    snippetsServices.push(entry);
    updateSnippetsProvider();
    const getSnippets = SnippetsProvider.getSnippets;
    const getUserSnippetsPath = SnippetsProvider.getUserSnippetsPath;
    return new Disposable(() => {
      const index = snippetsServices.indexOf(entry);
      if (index >= 0) snippetsServices.splice(index, 1);
      if (
        SnippetsProvider.getSnippets === getSnippets &&
        SnippetsProvider.getUserSnippetsPath === getUserSnippetsPath
      ) {
        updateSnippetsProvider();
      }
    });
  },

  createSettingsView(params) {
    if (SettingsView == null) SettingsView = require("./settings-view");
    params.packageManager = getPackageManager();
    params.snippetsProvider = SnippetsProvider;
    settingsView = new SettingsView(params);
    return settingsView;
  },
};

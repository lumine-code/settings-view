let SettingsView = null;
let settingsView = null;
let statusViewIcon = null;

let PackageManager = null;
let packageManager = null;

const recentSettings = require("./recent-settings");

const SnippetsProvider = {
  getSnippets() {
    return lumine.config.scopedSettingsStore.propertySets;
  },
};

const CONFIG_URI = "lumine://config";

function getPackageManager() {
  if (PackageManager == null) PackageManager = require("./package-manager");
  if (packageManager == null) packageManager = new PackageManager();
  return packageManager;
}

module.exports = {
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
    });

    lumine.commands.add("lumine-workspace", {
      "settings-view:open"() {
        lumine.workspace.open(CONFIG_URI);
      },
      "settings-view:core"() {
        lumine.workspace.open(`${CONFIG_URI}/core`);
      },
      "settings-view:editor"() {
        lumine.workspace.open(`${CONFIG_URI}/editor`);
      },
      "settings-view:show-keybindings"() {
        lumine.workspace.open(`${CONFIG_URI}/keybindings`);
      },
      "settings-view:install-packages-and-themes"() {
        lumine.workspace.open(`${CONFIG_URI}/install`);
      },
      "settings-view:view-installed-themes"() {
        lumine.workspace.open(`${CONFIG_URI}/themes`);
      },
      "settings-view:uninstall-themes"() {
        lumine.workspace.open(`${CONFIG_URI}/themes`);
      },
      "settings-view:use-light-mode"() {
        lumine.config.set("theme.mode", "light");
      },
      "settings-view:use-dark-mode"() {
        lumine.config.set("theme.mode", "dark");
      },
      "settings-view:use-system-mode"() {
        lumine.config.set("theme.mode", "system");
      },
      "settings-view:view-installed-packages"() {
        lumine.workspace.open(`${CONFIG_URI}/packages`);
      },
      "settings-view:uninstall-packages"() {
        lumine.workspace.open(`${CONFIG_URI}/packages`);
      },
      "settings-view:check-updates"() {
        lumine.workspace.open(`${CONFIG_URI}/update`);
      },
      "settings-view:clear-recent-settings"() {
        recentSettings.clear();
      },
    });

    if (process.platform === "win32" && require("lumine").WinShell != null) {
      lumine.commands.add("lumine-workspace", {
        "settings-view:system"() {
          lumine.workspace.open(`${CONFIG_URI}/system`);
        },
      });
    }
  },

  deactivate() {
    if (settingsView) settingsView.destroy();
    settingsView = null;
    packageManager = null;
    lumine.notifications.addWarning(
      "Warning! You have disabled the settings-view package. To enable it again, edit [`config.json`](https://github.com/lumine-code/lumine#configuration) and remove `settings-view` from `core.disabledPackages`.",
    );
  },

  consumeStatusBar(statusBar) {
    // Attach a settings button to the status bar
    if (lumine.config.get("settings-view.showSettingsIconInStatusBar")) {
      const SettingsIconStatusView = require("./settings-icon-status-view");
      statusViewIcon = new SettingsIconStatusView(statusBar);
      statusViewIcon.attach();
    }
  },

  consumeSnippets(snippets) {
    if (typeof snippets.getUnparsedSnippets === "function") {
      SnippetsProvider.getSnippets = snippets.getUnparsedSnippets.bind(snippets);
    }
    if (typeof snippets.getUserSnippetsPath === "function") {
      SnippetsProvider.getUserSnippetsPath = snippets.getUserSnippetsPath.bind(snippets);
    }
  },

  createSettingsView(params) {
    if (SettingsView == null) SettingsView = require("./settings-view");
    params.packageManager = getPackageManager();
    params.snippetsProvider = SnippetsProvider;
    settingsView = new SettingsView(params);
    return settingsView;
  },
};

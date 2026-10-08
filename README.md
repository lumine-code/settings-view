# settings-view

Edit config settings, install packages, and change themes.

Fork of [pulsar-edit/pulsar](https://github.com/pulsar-edit/pulsar) (`packages/settings-view`).

## Features

- **Settings editor**: browse and change core, editor, and package settings globally or only in this window.
- **Package management**: install, uninstall, and update packages.
- **Theme management**: install, uninstall, and switch between UI and syntax themes.
- **Keybinding browser**: view all active keybindings in one place.
- **Settings search**: find individual settings by name across every panel, with the ones you opened most recently listed first.
- **Status bar integration**: open settings from the status bar and see when package updates are available.

## Installation

To install `settings-view` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/settings-view`.

## Package catalogs

The `settings-view.packageCatalogs` setting accepts ordered catalog repositories or `index.json` URLs. Each index is a JSON array containing Git source strings, pre-resolved package snapshots, or both; source-only entries are resolved and fetched by Lumine, while valid snapshots provide the same metadata and ref information without per-repository requests.

## Commands

Commands available in `lumine-workspace`:

- `settings-view:open`: open the settings view,
- `settings-view:core`: open the core settings panel,
- `settings-view:editor`: open the editor settings panel,
- `settings-view:show-keybindings`: open the keybindings panel,
- `settings-view:install-packages-and-themes`: open the install panel,
- `settings-view:view-installed-themes`: open the themes panel to view installed themes,
- `settings-view:uninstall-themes`: open the themes panel to manage themes,
- `settings-view:use-light-mode`: force the light theme mode,
- `settings-view:use-dark-mode`: force the dark theme mode,
- `settings-view:use-system-mode`: follow the system light/dark preference,
- `settings-view:view-installed-packages`: open the packages panel,
- `settings-view:uninstall-packages`: open the packages panel to manage packages,
- `settings-view:check-updates`: open the install panel and check for package updates,
- `settings-view:clear-recent-settings`: forget the settings listed as recently opened in the search panel,
- `settings-view:system`: open the system panel (Windows only).

## Usage

Configuration panels have a checkbox immediately to the left of the scope field. Leave it unchecked to save changes globally in your config file and share them with every window. Check it to create temporary overrides only in this window without saving them; they expire when the window is reloaded or closed. Scope selectors work independently in either target, and project settings keep their existing priority.

When editing only this window, check a setting's override checkbox to copy its inherited value, then edit it. Unchecking that setting's checkbox removes its exact local override and reveals the latest inherited value. A checked override checkbox means an override exists even when it equals the inherited value. Settings that require global configuration are disabled with an explanation.

Changing the same setting globally in this window removes its local override. Config file updates arriving from another window preserve local overrides. Existing commands, the Themes panel, package installation, and system integration retain their global behavior. The checkbox beside the scope field is unchecked after a window reload; closing Settings alone does not remove local overrides.

## Services

- `status-bar`: consumed to add a settings icon and a package-updates indicator to the status bar.
- `snippets`: consumed to read user snippets so they can be displayed alongside settings.

## Customization

Adjust the settings view to taste by adding CSS to your `styles.css`:

```css
.settings-view {
  font-size: 15px;
}
```

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!

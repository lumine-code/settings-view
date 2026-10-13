# settings-view

Edit config settings, install packages, and change themes.

Fork of [pulsar-edit/pulsar](https://github.com/pulsar-edit/pulsar) (`packages/settings-view`).

## Features

- **Settings editor**: browse and change core, editor, and package settings globally or only in this window.
- **Package management**: install, uninstall, and update packages.
- **Theme management**: install, uninstall, and switch between UI and syntax themes.
- **Keybinding browser**: view all active keybindings in one place.
- **Settings search**: find individual settings by name across every panel, with the ones you opened most recently listed first.
- **Status bar integration**: open settings from the status bar, choose a settings panel from its context menu, and see when package updates are available.

## Installation

To install `settings-view` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/settings-view`.

## Package catalogs

See [Packages and themes](docs/packages.md) for install sources, catalogs, package precedence and update policies.

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

See [Configuration and scoped settings](docs/configuration.md) for saved settings, temporary window overrides, scope selectors and config files. These guides are also available under Settings → the package → Documentation.

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

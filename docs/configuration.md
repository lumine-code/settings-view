# Configuration and scoped settings

Settings View edits saved configuration shared between windows and temporary overrides belonging to the current window. Each edit also selects a base, grammar or syntax scope. The editor's [Config API reference](https://lumine-code.github.io/api/#class-config) defines the underlying resolution and write contracts.

## The Settings view

Core covers application-wide behavior, while Editor covers text editing, fonts, wrapping, scrolling, and indentation. Other panels manage Git, keybindings, packages, themes, updates, and installs; platform-specific panels appear when relevant. Every setting is documented inline, including its type, default and effect.

Configuration pages have a checkbox immediately to the left of the scope field. Leave it unchecked to save changes globally in your config file and share them with every window. Check it to edit temporary overrides only in the current window. Its tooltip explains the two modes. The scope field chooses the selector independently of this edit target.

Settings that apply to the entire application are unavailable locally, with an explanation beside the control. Theme selection, package installation and system integration panels continue to make global changes. Existing commands that write settings without requesting a local override also retain their global behavior.

## The config file

Settings are stored in `config.json` inside the active configuration directory, normally `~/.lumine`. A manually created `config.jsonc` works too. Open the active file with `application:open-your-config`. Lumine accepts JSON comments and trailing commas:

```json
{
  "*": {
    "core": {
      "restorePreviousState": "yes"
    },
    "editor": {
      "fontSize": 14,
      "showInvisibles": true
    }
  }
}
```

The top-level `"*"` key holds base settings. Values changed with the window checkbox unchecked in Settings are written here automatically, and scoped values inherit from this block. Saved changes propagate to other windows.

A legacy `config.cson` is not loaded. Convert it to `config.json` or `config.jsonc` before moving it into your Lumine configuration directory.

Keybindings, snippets, styles and startup code use their own files in the same configuration directory. See the [customization guide](https://lumine-code.github.io/docs.html#customization/personalizing-lumine) for their locations and editing commands.

## Temporary window settings

Local overrides live only in the current window's memory. They are never written to the config file, copied to another window, or included in saved window state. They disappear when you reload or close the window; closing Settings or reloading a package leaves them in place. The window checkbox is unchecked after a window reload.

With the window checkbox checked, check an individual setting's override checkbox to copy its inherited value, then edit it. Unchecking that setting's checkbox removes its exact local override and reveals the latest inherited value. A checked checkbox means an override exists even when it equals the inherited value.

If another window or an external editor changes the config file, this window receives the new global values while keeping its local overrides, including overrides of the same setting. Removing an override reveals the latest global value. A normal global write to a setting in this window also removes that setting's local override for the same selector. Local overrides for other selectors remain intact.

A local value replaces the corresponding user-config entry before normal configuration resolution. Project settings and more specific language or syntax selectors keep their existing priority; a local base value does not force every project or language to use it.

The Command Palette's `core:toggle-local-vcs-ignored-paths` uses a local override to include or exclude VCS-ignored files in project discovery for the current window. The shared file index rebuilds automatically when the effective policy changes. `core.ignoredNames` still applies.

Packages and startup code can use the same API:

```js
// Change only this window.
lumine.config.set("editor.fontSize", 20, { local: true });

// Reads and observers automatically include local overrides.
lumine.config.get("editor.fontSize");

// Remove the override and inherit the latest global value.
lumine.config.unset("editor.fontSize", { local: true });

// A normal write saves globally and removes this key's local override.
lumine.config.set("editor.fontSize", 14);
```

The `local` option can be combined with `scopeSelector`. Schema entries may disallow local writes with `allowLocal: false`; see [Developing a package](https://github.com/lumine-code/lumine/blob/master/docs/developing-a-package.md#configuration-in-one-window) for consumer requirements and the [Config API](https://lumine-code.github.io/api/#class-config) for validation and errors.

## Scoped settings

Any setting can be stored under a scope selector. Packages decide whether they read the base value or resolve it for an editor or syntax position, so scoped values are most useful for settings documented as language- or syntax-aware.

### The scope selector

Every configuration page has an editable scope field beside its heading, wrapping below it when the panel is narrow. An empty field means Default and edits the base values; enter a custom selector or use the field's arrow to choose a known selector from the list.

An inherited setting is grey and has an unchecked override checkbox. Checking it copies the inherited value into the selected target and selector; unchecking it removes only that override. With the window checkbox checked, base settings also have an override checkbox.

Each setting's checkbox also shows how the owning package reads it: grey means `base`, green means `grammar`, and purple means the full `syntax` scope at a position. This is descriptive metadata; Config still permits a scoped value for every key.

### How scoping works

In `config.json`, a scoped block is keyed by its selector rather than by `"*"`:

```jsonc
{
  "*": {
    "editor": {
      "tabLength": 2,
      "tabType": "auto",
    },
  },
  ".source.makefile": {
    "editor": {
      // Makefiles require real tabs
      "tabLength": 4,
      "tabType": "hard",
    },
  },
}
```

Here tabs render two columns wide by default. Makefiles insert hard tab characters and render them four columns wide. The Settings scope selector writes these blocks for you; custom selectors may also address nested syntax, for example `.source.js .meta.block.jsx.js`.

### Scoped settings in one window

Check the window checkbox and choose a selector to override that selector's user settings without changing the config file. Changing the checkbox or selector only changes what Settings displays; it does not write values. Local overrides follow the [same priority and lifetime rules](#temporary-window-settings) as base overrides.

The equivalent API accepts both options:

```js
lumine.config.set("editor.tabLength", 4, {
  local: true,
  scopeSelector: ".source.python",
});

lumine.config.unset("editor.tabLength", {
  local: true,
  scopeSelector: ".source.python",
});
```

## Scrolling

Distance and animation duration are independent settings under Editor. Their inline descriptions document the supported ranges and defaults. Turning off smooth scrolling or setting a duration to zero applies movement without interpolation; system momentum keeps its supplied deceleration. Scroll-command settings affect scrolling commands rather than cursor movement or Page Up and Page Down.

Navigation destinations use the shared `editor.scrollZone`, including language and temporary window overrides. Percentages refer to the space between vertical scroll margins: `0` is the top, `100` the bottom, and `50` the center. A one-number array such as `[50]` fixes the landing position. A pair defines both a zone that needs no scrolling and the landing positions after leaving it through the top and bottom.

An ordered pair such as `[20, 70]` returns a destination to the edge it crossed; an inverted pair such as `[70, 20]` lands it on the opposite edge to leave more space ahead. `[0, 100]` gives nearest-position behavior. The available space accounts for the revealed range's height, and an oversized range follows its active end. Horizontal scrolling still uses the ordinary horizontal margins.

Ordinary typing and selection changes use nearest-position scrolling, while navigation and `editor:scroll-to-zone` use the configured zone. Changing the setting affects the next reveal without moving the current viewport. Packages choose a reveal mode through the [TextEditor API](https://lumine-code.github.io/api/#texteditor-instance-scrolltobufferposition); see [Revealing positions](https://github.com/lumine-code/lumine/blob/master/docs/developing-a-package.md#revealing-positions) for examples.

## Choosing a grammar for a file

Language-aware settings use the editor's selected grammar. The [grammar-selector](https://github.com/lumine-code/grammar-selector) package lets you choose a grammar manually or return to Auto Detect. Its README explains the current-language and checkmark indicators. [Creating a grammar](https://github.com/lumine-code/lumine/blob/master/docs/creating-a-grammar.md) describes descriptors and scope names.

## Default file encoding

The [encoding-selector](https://github.com/lumine-code/encoding-selector) package owns the encoding picker and its Auto Detect mode. The configured `editor.fileEncoding` supplies the initial default for the file's grammar. Requesting Auto Detect reads an existing saved file to detect its encoding; for an unsaved file, it restores that configured default.

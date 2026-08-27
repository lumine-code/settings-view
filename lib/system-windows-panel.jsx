/** @jsx etch.dom */
const { WinShell, CompositeDisposable } = require("lumine");
const etch = require("@lumine-code/etch");

module.exports = class SystemPanel {
  constructor() {
    etch.initialize(this);
    this.element.setAttribute("aria-busy", "true");
    this.registrationChecks = [
      [WinShell.fileHandler, this.refs.fileHandlerCheckbox],
      [WinShell.fileContextMenu, this.refs.fileContextMenuCheckbox],
      [WinShell.folderContextMenu, this.refs.folderContextMenuCheckbox],
    ];
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      lumine.commands.add(this.element, {
        "core:move-up": () => {
          this.scrollUp();
        },
        "core:move-down": () => {
          this.scrollDown();
        },
        "core:page-up": () => {
          this.pageUp();
        },
        "core:page-down": () => {
          this.pageDown();
        },
        "core:move-to-top": () => {
          this.scrollToTop();
        },
        "core:move-to-bottom": () => {
          this.scrollToBottom();
        },
      }),
    );
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.registrationCheckFrame);
    clearTimeout(this.registrationCheckTimer);
    this.subscriptions.dispose();
    return etch.destroy(this);
  }

  update() {}

  render() {
    return (
      <div className="panels-item" tabIndex="0">
        <form className="general-panel section">
          <div className="settings-panel">
            <div className="section-container">
              <div className="block section-heading icon icon-device-desktop">System Settings</div>
              <div className="text icon icon-question">
                These settings determine how Lumine integrates with your operating system.
              </div>
              <div className="section-body">
                <div className="control-group">
                  <div className="controls">
                    <div className="checkbox">
                      <label for="system.windows.file-handler">
                        <input
                          ref="fileHandlerCheckbox"
                          id="system.windows.file-handler"
                          className="input-checkbox"
                          type="checkbox"
                          disabled
                          onclick={(e) => {
                            this.setRegistration(WinShell.fileHandler, e.target.checked);
                          }}
                        />
                        <div className="setting-title">Register as file handler</div>
                        <div className="setting-description">
                          Show {WinShell.appName} in the "Open with" application list for easy
                          association with file types.
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
                <div className="control-group">
                  <div className="controls">
                    <div className="checkbox">
                      <label for="system.windows.shell-menu-files">
                        <input
                          ref="fileContextMenuCheckbox"
                          id="system.windows.shell-menu-files"
                          className="input-checkbox"
                          type="checkbox"
                          disabled
                          onclick={(e) => {
                            this.setRegistration(WinShell.fileContextMenu, e.target.checked);
                          }}
                        />
                        <div className="setting-title">Show in file context menus</div>
                        <div className="setting-description">
                          Add "Open with {WinShell.appName}" to the File Explorer context menu for
                          files.
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
                <div className="control-group">
                  <div className="controls">
                    <div className="checkbox">
                      <label for="system.windows.shell-menu-folders">
                        <input
                          ref="folderContextMenuCheckbox"
                          id="system.windows.shell-menu-folders"
                          className="input-checkbox"
                          type="checkbox"
                          disabled
                          onclick={(e) => {
                            this.setRegistration(WinShell.folderContextMenu, e.target.checked);
                            this.setRegistration(
                              WinShell.folderBackgroundContextMenu,
                              e.target.checked,
                            );
                          }}
                        />
                        <div className="setting-title">Show in folder context menus</div>
                        <div className="setting-description">
                          Add "Open with {WinShell.appName}" to the File Explorer context menu for
                          folders.
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
    );
  }

  setRegistration(option, shouldBeRegistered) {
    if (shouldBeRegistered) {
      return option.register(function () {});
    } else {
      return option.deregister(function () {});
    }
  }

  focus() {
    this.element.focus();
  }

  show() {
    this.element.style.display = "";
    this.scheduleRegistrationChecks();
  }

  scheduleRegistrationChecks() {
    if (this.registrationChecksStarted) return;
    this.registrationChecksStarted = true;
    this.registrationCheckFrame = requestAnimationFrame(() => {
      this.registrationCheckFrame = null;
      this.registrationCheckTimer = setTimeout(() => this.runNextRegistrationCheck(), 0);
    });
  }

  runNextRegistrationCheck() {
    this.registrationCheckTimer = null;
    if (this.destroyed) return;
    const check = this.registrationChecks.shift();
    if (!check) {
      this.element.removeAttribute("aria-busy");
      return;
    }
    const [option, checkbox] = check;
    option.isRegistered((isRegistered) => {
      if (this.destroyed) return;
      checkbox.checked = isRegistered;
      checkbox.disabled = false;
      this.registrationCheckTimer = setTimeout(() => this.runNextRegistrationCheck(), 0);
    });
  }

  scrollUp() {
    this.element.scrollTop -= document.body.offsetHeight / 20;
  }

  scrollDown() {
    this.element.scrollTop += document.body.offsetHeight / 20;
  }

  pageUp() {
    this.element.scrollTop -= this.element.offsetHeight;
  }

  pageDown() {
    this.element.scrollTop += this.element.offsetHeight;
  }

  scrollToTop() {
    this.element.scrollTop = 0;
  }

  scrollToBottom() {
    this.element.scrollTop = this.element.scrollHeight;
  }
};

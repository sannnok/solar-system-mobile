/**
 * A thin adapter over the Telegram Mini Apps SDK (telegram-web-app.js).
 *
 * Everything the app needs from Telegram goes through here, and every call is
 * a no-op in a plain browser — so the same page runs as a Mini App, on a phone
 * over the LAN, or later as a PWA without changes elsewhere.
 *
 * The SDK defines window.Telegram.WebApp even outside Telegram; only a real
 * client passes signed initData, so that is what "inside" checks.
 * initDataUnsafe is for display only — anything that grants access (a paid
 * programme, say) must verify initData on the server.
 */

const tg = window.Telegram?.WebApp ?? null;
const inside = Boolean(tg?.initData);
const atLeast = (version) => Boolean(inside && tg.isVersionAtLeast?.(version));

let backHandler = null;
let mainHandler = null;

export const telegram = {
  inside,
  platform: inside ? tg.platform : 'browser',
  user: inside ? tg.initDataUnsafe?.user ?? null : null,
  canFullscreen: atLeast('8.0'),

  init(color) {
    if (!inside) return;
    tg.ready();
    tg.expand();
    // Dragging the 3D model downwards would otherwise close the app.
    if (atLeast('7.7')) tg.disableVerticalSwipes();
    if (atLeast('6.1')) {
      tg.setHeaderColor(color);
      tg.setBackgroundColor(color);
    }
    if (atLeast('7.10')) tg.setBottomBarColor(color);
  },

  haptic(kind = 'light') {
    if (!atLeast('6.1')) return;
    const h = tg.HapticFeedback;
    if (kind === 'select') h.selectionChanged();
    else if (kind === 'success' || kind === 'warning' || kind === 'error') h.notificationOccurred(kind);
    else h.impactOccurred(kind);
  },

  /** Telegram's own back button — closes our overlays the way users expect. */
  backButton(visible, handler) {
    if (!atLeast('6.1')) return;
    if (backHandler) tg.BackButton.offClick(backHandler);
    backHandler = null;
    if (visible) {
      backHandler = handler;
      tg.BackButton.onClick(handler);
      tg.BackButton.show();
    } else {
      tg.BackButton.hide();
    }
  },

  mainButton(text, handler) {
    if (!inside) return;
    if (mainHandler) tg.MainButton.offClick(mainHandler);
    mainHandler = handler;
    tg.MainButton.setParams({ text, color: '#3cf2c0', text_color: '#04110d', is_visible: true });
    tg.MainButton.onClick(handler);
  },

  popup(title, message) {
    if (atLeast('6.2')) tg.showPopup({ title, message, buttons: [{ type: 'ok' }] });
    else window.alert(`${title}\n\n${message}`);
  },

  toggleFullscreen() {
    if (!this.canFullscreen) return;
    if (tg.isFullscreen) tg.exitFullscreen();
    else tg.requestFullscreen();
  },

  on(event, handler) {
    if (inside) tg.onEvent(event, handler);
  },

  /**
   * Small per-user settings. Inside Telegram they go to CloudStorage, so they
   * follow the user across devices; in a browser, localStorage — which may be
   * unavailable (private mode), so every call degrades to "nothing stored".
   */
  storage: {
    get(key) {
      if (atLeast('6.9')) {
        return new Promise((resolve) => tg.CloudStorage.getItem(key, (error, value) => resolve(error ? null : value || null)));
      }
      try {
        return Promise.resolve(window.localStorage.getItem(key));
      } catch {
        return Promise.resolve(null);
      }
    },
    set(key, value) {
      if (atLeast('6.9')) return new Promise((resolve) => tg.CloudStorage.setItem(key, value, () => resolve()));
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Nothing to do: the value simply is not kept.
      }
      return Promise.resolve();
    },
  },
};

import {
  setDebug,
  themeParams,
  initData,
  viewport,
  init as initSDK,
  mockTelegramEnv,
  type ThemeParams,
  retrieveLaunchParams,
  emitEvent,
  miniApp,
  backButton,
} from '@tma.js/sdk-react';

/**
 * Initializes the application and configures its dependencies.
 */
export async function init(options: {
  debug: boolean;
  eruda: boolean;
  mockForMacOS: boolean;
}): Promise<void> {
  // Set @telegram-apps/sdk-react debug mode and initialize it.
  setDebug(options.debug);
  initSDK();

  // Add Eruda if needed.
  if (options.eruda) {
    const { default: eruda } = await import('eruda');
    eruda.init();
    eruda.position({ x: window.innerWidth - 50, y: 0 });
  }

  // Telegram for macOS has a ton of bugs, including cases, when the client doesn't
  // even response to the "web_app_request_theme" method. It also generates an incorrect
  // event for the "web_app_request_safe_area" method.
  if (options.mockForMacOS) {
    let firstThemeSent = false;
    mockTelegramEnv({
      onEvent(event, next) {
        if (event.name === 'web_app_request_theme') {
          let tp: ThemeParams = {};
          if (firstThemeSent) {
            tp = themeParams.state();
          } else {
            firstThemeSent = true;
            tp ||= retrieveLaunchParams().tgWebAppThemeParams;
          }
          return emitEvent('theme_changed', { theme_params: tp });
        }

        if (event.name === 'web_app_request_safe_area') {
          return emitEvent('safe_area_changed', { left: 0, top: 0, right: 0, bottom: 0 });
        }

        next();
      },
    });
  }

  // Mount all components used in the project.
  try {
    backButton.mount.ifAvailable();
  } catch (error) {
    console.warn('[init] Failed to mount back button', error);
  }

  try {
    initData.restore();
  } catch (error) {
    console.warn('[init] Failed to restore init data', error);
  }

  if (miniApp.mount.isAvailable()) {
    try {
      themeParams.mount();
    } catch (error) {
      console.warn('[init] Failed to mount theme params', error);
    }

    try {
      miniApp.mount();
    } catch (error) {
      console.warn('[init] Failed to mount mini app', error);
    }

    try {
      themeParams.bindCssVars();
    } catch (error) {
      console.warn('[init] Failed to bind theme params CSS variables', error);
    }
  }

  if (viewport.mount.isAvailable()) {
    try {
      await viewport.mount();
    } catch (error) {
      console.warn('[init] Failed to mount viewport', error);
    }

    try {
      viewport.bindCssVars();
    } catch (error) {
      console.warn('[init] Failed to bind viewport CSS variables', error);
    }
  }
}

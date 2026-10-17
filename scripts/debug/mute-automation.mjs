// Shared test-runner preload: mute output without suspending audio processing.
import { chromium } from 'playwright';
const installed = Symbol.for('dsh-tavern.muted-automation');
export function mutedOptions(options = {}) {
  return { ...options, args: [...(options.args || []).filter(arg => !/^--mute-audio(?:=|$)/.test(arg)), '--mute-audio'] };
}
export function muteBrowserLauncher(browserType) {
  if (browserType[installed]) return;
  for (const method of ['launch', 'launchServer']) {
    const launch = browserType[method].bind(browserType);
    browserType[method] = options => launch(mutedOptions(options));
  }
  const persistent = browserType.launchPersistentContext.bind(browserType);
  browserType.launchPersistentContext = (directory, options) => persistent(directory, mutedOptions(options));
  browserType[installed] = true;
}
muteBrowserLauncher(chromium);

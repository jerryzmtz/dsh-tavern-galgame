// private fork (owner 2026-10): the phone battery's three looks, one table for the stage phone (view/index.html loads
// this file before index.js) and the settings preview (the client bundle includes it, fork-mod-config-pages.js): above
// 40% the normal ink, at or below 40% yellow, at or below 20% red. No per-card setting.
var FORK_PHONE_BATTERY = Object.freeze({ warn: 40, low: 20 });
function forkPhoneBatteryLevel(percent) { return percent <= FORK_PHONE_BATTERY.low ? 'low' : percent <= FORK_PHONE_BATTERY.warn ? 'warn' : 'ok'; }

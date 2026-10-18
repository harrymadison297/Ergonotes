// Which build of Ergonotes suits the visitor's device. Kept apart from the page so it can be tested with plain user-agent strings.
export type Os = 'windows' | 'linux' | 'android' | 'macos' | 'ios' | 'other';
export interface Platform { os: Os; /** a Debian-family Linux (the .deb fits) */ deb: boolean; /** an ARM computer: no Linux ARM build yet */ arm: boolean }

/** `uaPlatform` is `navigator.userAgentData.platform`, `touchPoints` is `navigator.maxTouchPoints` (an iPad says it is a Mac). */
export function detectPlatform(ua: string, uaPlatform = '', touchPoints = 0): Platform {
  const arm = /aarch64|arm64|armv[78]/i.test(ua);
  const deb = /Ubuntu|Debian|Linux Mint|Pop!_OS|elementary/i.test(ua);
  const make = (os: Os): Platform => ({ os, deb: os === 'linux' && deb, arm: os === 'linux' && arm });
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1)) return make('ios');
  if (/Android/i.test(ua) || /^Android$/i.test(uaPlatform)) return make('android');
  if (/Windows/i.test(ua) || /^Windows$/i.test(uaPlatform)) return make('windows');
  if (/Macintosh|Mac OS X/i.test(ua) || /^macOS$/i.test(uaPlatform)) return make('macos');
  if (/CrOS/i.test(ua)) return make('other');
  if (/Linux|X11/i.test(ua) || /^Linux$/i.test(uaPlatform)) return make('linux');
  return make('other');
}

export const FILES = {
  windows: 'Ergonotes-windows-x64-setup.exe',
  deb: 'Ergonotes-linux-amd64.deb',
  appImage: 'Ergonotes-linux-x86_64.AppImage',
  android: 'Ergonotes-android.apk',
} as const;

/** The file to offer first, or null where there is no build (macOS, iPhone and iPad, ARM Linux, Chromebooks). */
export function recommendedFile(p: Platform): string | null {
  if (p.os === 'windows') return FILES.windows;
  if (p.os === 'android') return FILES.android;
  if (p.os === 'linux' && !p.arm) return p.deb ? FILES.deb : FILES.appImage;
  return null;
}

export const OS_NAME: Record<Os, string> = { windows: 'Windows', linux: 'Linux', android: 'Android', macos: 'macOS', ios: 'iPhone and iPad', other: 'your device' };

export function currentPlatform(): Platform {
  if (typeof navigator === 'undefined') return detectPlatform('');
  const uad = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return detectPlatform(navigator.userAgent, uad?.platform ?? '', navigator.maxTouchPoints ?? 0);
}

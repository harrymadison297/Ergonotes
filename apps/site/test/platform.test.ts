import { describe, expect, it } from 'vitest';
import { detectPlatform, FILES, recommendedFile } from '../src/platform.ts';

const UA = {
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  ubuntuFirefox: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  linuxArm: 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
};

describe('the download for this device', () => {
  it('gives Windows the installer and Android the apk', () => {
    expect(recommendedFile(detectPlatform(UA.win))).toBe(FILES.windows);
    expect(recommendedFile(detectPlatform(UA.winEdge))).toBe(FILES.windows);
    expect(recommendedFile(detectPlatform(UA.android))).toBe(FILES.android);
  });

  it('is not fooled by Android saying it is Linux', () => {
    expect(detectPlatform(UA.android).os).toBe('android');
  });

  it('gives a Debian-family Linux the .deb and any other Linux the AppImage', () => {
    expect(recommendedFile(detectPlatform(UA.ubuntuFirefox))).toBe(FILES.deb);
    expect(recommendedFile(detectPlatform(UA.linux))).toBe(FILES.appImage);
    expect(detectPlatform(UA.linux, 'Linux').os).toBe('linux');
  });

  it('offers nothing first where there is no build', () => {
    expect(recommendedFile(detectPlatform(UA.linuxArm))).toBeNull();
    expect(recommendedFile(detectPlatform(UA.mac))).toBeNull();
    expect(detectPlatform(UA.mac).os).toBe('macos');
    expect(recommendedFile(detectPlatform(UA.iphone))).toBeNull();
    expect(recommendedFile(detectPlatform(UA.chromebook))).toBeNull();
    expect(recommendedFile(detectPlatform(''))).toBeNull();
  });

  it('knows an iPad that says it is a Mac, and trusts the platform hint when the string is bare', () => {
    expect(detectPlatform(UA.mac, 'macOS', 5).os).toBe('ios');
    expect(detectPlatform(UA.mac, 'macOS', 0).os).toBe('macos');
    expect(detectPlatform('Mozilla/5.0', 'Windows').os).toBe('windows');
  });
});

# Microsoft Visual C++ runtime, installed beside the Windows app

The speech engine (whisper.cpp, ADR 0016) is C++ built for Windows and needs `msvcp140.dll` and `vcruntime140.dll`. A clean
Windows does not have them, and without them the app does not start. These three files are the redistributable runtime
(version 14.44.35211.0, from `vc_redist.x64.exe`, https://aka.ms/vs/17/release/vc_redist.x64.exe), which Microsoft lets
applications ship next to their own executable ("app-local deployment"; see `REDIST.TXT` of Visual Studio).
`tauri.windows.conf.json` puts them in the install folder; `tools/build-desktop.sh` puts them in the portable zip.

| file | sha256 |
|---|---|
| msvcp140.dll | 0f885b509a685d2bbfa652fed26b5fb31d88fbdab0a978c641d1c7b8aa460aa9 |
| vcruntime140.dll | d5e4d9a3e835fa679450145d6a7d94e36573a509317111904d9b3712c30d9066 |
| vcruntime140_1.dll | 1f2d41c4aa5db0bc33ebf7b66d72943a817d7ce6cbe880502a9403823633093f |

To update: install the newest `vc_redist.x64.exe` on a Windows machine and copy the three files from `C:\Windows\System32`.

; Tauri's NSIS template puts the product name, description and copyright into the installer's file properties but not the
; company, so Windows shows no publisher for it (Properties -> Details, the download warning). This adds it. The name is written out
; because MANUFACTURER is not defined yet where this file is included; keep it equal to `bundle.publisher` in tauri.conf.json.
VIAddVersionKey "CompanyName" "Ergonotes"

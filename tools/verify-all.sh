#!/bin/bash
# Runs the whole test matrix against the VMs described in docs/testbed.md, from a clean state:
#   unit tests -> Linux VM server (browser e2e) -> device-in-browser sync -> Android emulator -> Windows 11 VM
# Usage: tools/verify-all.sh   (VMs/containers must be up; see docs/testbed.md)
cd "$(dirname "$0")/.."
R=$PWD; KEY=$R/temp/vms/linux/key
SSHO="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=20"
PW="docker run --rm --network host --user $(id -u):$(id -g) -e HOME=/tmp -v $R:/repo -v $R/temp/pw/node_modules:/repo/packages/app/e2e/node_modules:ro -w /repo/packages/app/e2e mcr.microsoft.com/playwright:v1.55.0-noble node"
NODE="docker run --rm --network host --user $(id -u):$(id -g) -e HOME=/tmp -v $R:/repo -w /repo/packages/app/e2e node:24-bookworm node"
declare -A RESULT
run() { # name, command...
  local name="$1"; shift
  echo; echo "================ $name"
  if "$@" 2>&1 | tee "$R/temp/out/verify-$(echo "$name" | tr ' /' '__').log" | grep -E "^(PASS|FAIL)|passed|failed|Tests |Test Files|Error" ; [ "${PIPESTATUS[0]}" -eq 0 ]; then RESULT[$name]=PASS; else RESULT[$name]=FAIL; fi
}

echo "### reset shared state"
docker rm -f ergonotes-minio >/dev/null 2>&1; rm -rf temp/minio-e2e; mkdir -p temp/minio-e2e
docker run -d --name ergonotes-minio --user "$(id -u):$(id -g)" -p 0.0.0.0:19000:9000 -e MINIO_ROOT_USER=spike -e MINIO_ROOT_PASSWORD=spikepass12345 -v "$R/temp/minio-e2e:/data" quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z server /data >/dev/null
scp -i "$KEY" $SSHO -P 2222 dist/release/ergonotes-server.tgz ergo@127.0.0.1:/tmp/ >/dev/null
ssh -i "$KEY" $SSHO -p 2222 ergo@127.0.0.1 'sudo systemctl stop ergonotes; sudo rm -rf /var/lib/ergonotes/* /opt/ergonotes/*; sudo tar -xzf /tmp/ergonotes-server.tgz -C /opt/ergonotes; sudo systemctl start ergonotes; sleep 2; echo "server peer in the Linux VM: $(systemctl is-active ergonotes)"'
(pgrep -f "http.server 18090" >/dev/null) || (cd packages/app/dist && nohup python3 -m http.server 18090 --bind 127.0.0.1 >/dev/null 2>&1 &)
# wait until MinIO and the static server answer instead of sleeping a fixed time
for i in $(seq 1 40); do curl -sf http://127.0.0.1:19000/minio/health/live >/dev/null && curl -sf http://127.0.0.1:18090/ >/dev/null && break; sleep 0.5; done

run "1 unit+integration tests (core, server, MCP)" tools/n npx vitest run
run "2 browser e2e on the Linux VM server" $PW smoke.mjs http://127.0.0.1:18080 /repo/temp/out/shots-verify-linux
run "2b AI assistant, suggestions, private notes (scripted provider)" $PW ai.mjs http://127.0.0.1:18080 /repo/temp/out/shots-verify-ai
run "2c Insert menu: every element stored as Markdown and read back" $PW insert.mjs http://127.0.0.1:18080 /repo/temp/out/shots-verify-insert
run "2d voice notes, meetings, dictation, transcription (fake microphone, scripted server)" $PW audio.mjs http://127.0.0.1:18080 /repo/temp/out/shots-verify-audio
run "3 two devices: server peer + offline-first device via MinIO" $PW sync.mjs http://127.0.0.1:18080 http://127.0.0.1:18090 http://10.0.2.2:19000 http://127.0.0.1:19000 /repo/temp/out/shots-verify-sync

echo; echo "### Android emulator: fresh install of the debug APK"
APK=apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
docker cp "$APK" ergonotes-android:/tmp/app.apk
docker exec ergonotes-android sh -c 'adb uninstall app.ergonotes.notes >/dev/null 2>&1; adb install -r /tmp/app.apk | tail -1; adb shell am start -n app.ergonotes.notes/.MainActivity >/dev/null; sleep 8; SOCK=$(adb shell cat /proc/net/unix | tr -d "\r" | grep -o "webview_devtools_remote_[0-9]*" | head -1); adb forward --remove-all >/dev/null; adb forward tcp:9222 localabstract:$SOCK'
run "4 Android app (Tauri APK in KVM emulator)" $NODE device.mjs http://127.0.0.1:9222 http://127.0.0.1:18080 http://10.0.2.2:19000 /repo/temp/out/shots-verify-android Android "Pixel emulator" "From Android"

echo; echo "### Windows 11 VM: fresh install of the NSIS installer"
cat > temp/out/winverify.ps1 <<'PS'
Get-Process ergonotes -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
if (Test-Path "$env:LOCALAPPDATA\Ergonotes\uninstall.exe") { Start-Process "$env:LOCALAPPDATA\Ergonotes\uninstall.exe" -ArgumentList "/S" -Wait }
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\app.ergonotes.notes" -ErrorAction SilentlyContinue
Start-Process -FilePath C:\Users\Docker\ergonotes-setup.exe -ArgumentList "/S" -Wait
"installed: " + (Get-Item "$env:LOCALAPPDATA\Ergonotes\ergonotes.exe").VersionInfo.ProductName
schtasks /Run /TN ErgoRun | Out-Null
Start-Sleep 14
try { "webview debug port: " + (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9223/json/version -TimeoutSec 5).StatusCode } catch { "no debug port" }
PS
sshpass -p admin scp -P 2223 $SSHO dist/release/Ergonotes-windows-x64-setup.exe Docker@127.0.0.1:C:/Users/Docker/ergonotes-setup.exe
tools/winrun.sh temp/out/winverify.ps1 2>&1 | grep -vE "CLIXML|<Objs"
(curl -s -m 3 http://127.0.0.1:19223/json/version >/dev/null) || sshpass -p admin ssh -f -N -L 19223:127.0.0.1:9223 -p 2223 $SSHO -o ExitOnForwardFailure=yes Docker@127.0.0.1
sleep 2
run "5 Windows 11 app (NSIS install in KVM VM)" $NODE device.mjs http://127.0.0.1:19223 http://127.0.0.1:18080 http://172.17.0.1:19000 /repo/temp/out/shots-verify-windows Windows "Windows 11 VM" "From Windows"

echo; echo "================ SUMMARY"
FAILED=0
for k in "${!RESULT[@]}"; do printf '%-62s %s\n' "$k" "${RESULT[$k]}"; [ "${RESULT[$k]}" = PASS ] || FAILED=1; done | sort
exit $FAILED

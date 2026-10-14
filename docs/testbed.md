# Test bed: KVM virtual machines

Everything runs under KVM on one Linux host (no root needed beyond membership of the `kvm` and `docker` groups).
Large files live under `temp/` (git-ignored). The exact commands used to verify the release artifacts:

## Shared Store (MinIO) and static device server

```sh
docker run -d --name ergonotes-minio -p 0.0.0.0:19000:9000 -e MINIO_ROOT_USER=spike -e MINIO_ROOT_PASSWORD=spikepass12345 \
  -v $PWD/temp/minio-e2e:/data quay.io/minio/minio server /data
(cd packages/app/dist && python3 -m http.server 18090 --bind 127.0.0.1)   # the app as an on-device, offline-first build
```

## Linux VM: server peer (Ubuntu 24.04 cloud image)

```sh
cd temp/vms/linux
curl -LO https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
qemu-img create -f qcow2 -F qcow2 -b noble.img disk.qcow2 20G
cloud-localds seed.iso user-data meta-data                     # user "ergo", your ssh key
qemu-system-x86_64 -enable-kvm -cpu host -smp 4 -m 4096 -daemonize \
  -drive file=disk.qcow2,if=virtio -drive file=seed.iso,if=virtio,format=raw,media=cdrom \
  -netdev user,id=n0,hostfwd=tcp:127.0.0.1:2222-:22,hostfwd=tcp:127.0.0.1:18080-:8080 -device virtio-net-pci,netdev=n0 -display none
# deploy: node 24 under /opt/node, `tar -xzf dist/release/ergonotes-server.tgz -C /opt/ergonotes`, systemd unit running
# `node /opt/ergonotes/server.mjs` with PORT=8080 ERGONOTES_DATA=/var/lib/ergonotes ERGONOTES_WEB=/opt/ergonotes/web
```

Inside the guest the host is `10.0.2.2` (that is where the server reaches MinIO).

## Windows 11 VM (Enterprise evaluation, downloaded by dockur/windows)

```sh
docker run -d --name ergonotes-windows --device=/dev/kvm --device=/dev/net/tun --cap-add NET_ADMIN \
  -e VERSION=11e -e RAM_SIZE=8G -e CPU_CORES=4 -e DISK_SIZE=64G -e USERNAME=Docker -e PASSWORD=admin -e USER_PORTS=22 \
  -p 127.0.0.1:8006:8006 -p 127.0.0.1:2223:22 -v $PWD/temp/vms/windows/storage:/storage -v $PWD/temp/vms/windows/oem:/oem dockurr/windows
# oem/install.bat enables the OpenSSH server on first boot; the VM sees the host at 172.17.0.1
```

Install and drive the app:

```sh
scp -P 2223 dist/release/Ergonotes-windows-x64-setup.exe Docker@127.0.0.1:C:/Users/Docker/
# silent install: ergonotes-setup.exe /S   -> %LOCALAPPDATA%\Ergonotes
# DevTools for the WebView2 window (test only): HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments
#   value "ergonotes.exe" = "--remote-debugging-port=9223 --remote-allow-origins=*"; start the app from a scheduled task
#   in the interactive session, tunnel with `ssh -L 19223:127.0.0.1:9223`.
```

## Android emulator (API 34, x86_64, KVM)

```sh
docker run -d --name ergonotes-android --device /dev/kvm --network host ergonotes-builder sh -c \
  'echo no | avdmanager create avd -n e2e -k "system-images;android-34;google_apis;x86_64" -d pixel_6 &&
   emulator -avd e2e -no-window -no-audio -no-snapshot -gpu swiftshader_indirect -memory 3072 -cores 4'
docker cp apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk ergonotes-android:/tmp/app.apk
docker exec ergonotes-android adb install -r /tmp/app.apk
# WebView DevTools (debug builds): adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
```

The device is reached from inside the emulator at `10.0.2.2`.

## Running the checks

```sh
# browser against the server peer (Playwright image mcr.microsoft.com/playwright:v1.55.0-noble)
node packages/app/e2e/smoke.mjs http://127.0.0.1:18080 shots/
# Server peer + an offline-first device through MinIO: auto-merge, conflict, resolution
node packages/app/e2e/sync.mjs http://127.0.0.1:18080 http://127.0.0.1:18090 http://10.0.2.2:19000 http://127.0.0.1:19000 shots/
# a real Tauri app (Android or Windows) through its WebView DevTools socket
node packages/app/e2e/device.mjs http://127.0.0.1:9222 http://127.0.0.1:18080 http://10.0.2.2:19000 shots/ Android "Pixel emulator" "From Android"
```

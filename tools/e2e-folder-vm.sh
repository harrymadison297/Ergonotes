#!/bin/bash
# The vault-folder end-to-end check (packages/app/e2e/folder.mjs) against the server peer in the Linux VM: the files
# are put in, and read back, on the VM's own disk over ssh. usage: tools/e2e-folder-vm.sh [baseUrl] [vaultDirInVm]
cd "$(dirname "$0")/.."
R=$PWD
BASE=${1:-http://127.0.0.1:18080}
VAULT=${2:-/home/ergo/Notes}
SSHJ='["ssh","-i","/tmp/key","-o","StrictHostKeyChecking=no","-o","UserKnownHostsFile=/dev/null","-o","LogLevel=ERROR","-p","2222","ergo@127.0.0.1"]'
exec docker run --rm --network host --user root -e VAULT_SSH="$SSHJ" -v "$R":/repo -v "$R/temp/pw/node_modules":/repo/packages/app/e2e/node_modules:ro -w /repo/packages/app/e2e \
  mcr.microsoft.com/playwright:v1.55.0-noble sh -c "apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq openssh-client >/dev/null 2>&1; cp /repo/temp/vms/linux/key /tmp/key; chmod 600 /tmp/key; node folder.mjs $BASE /repo/temp/out/shots-verify-folder $VAULT"

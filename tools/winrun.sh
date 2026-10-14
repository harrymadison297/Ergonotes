#!/bin/sh
# Run a PowerShell script (file) inside the Windows VM over SSH. Usage: tools/winrun.sh script.ps1
ENC=$(python3 -c "import base64,sys; print(base64.b64encode(open(sys.argv[1]).read().encode('utf-16-le')).decode())" "$1")
exec sshpass -p admin ssh -p 2223 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=20 Docker@127.0.0.1 "powershell -NoProfile -EncodedCommand $ENC"

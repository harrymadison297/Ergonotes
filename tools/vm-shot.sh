#!/bin/sh
# Screenshot of the Windows VM (dockur container) to PNG. Usage: tools/vm-shot.sh out.png
set -e
docker exec ergonotes-windows sh -c 'printf "screendump /tmp/s.ppm\n" | nc -U -w2 /run/shm/monitor.sock >/dev/null'
docker cp ergonotes-windows:/tmp/s.ppm /tmp/vm.ppm >/dev/null
python3 - "$1" <<'PY'
import sys,zlib,struct
d=open('/tmp/vm.ppm','rb').read()
parts=d.split(b'\n',3); w,h=map(int,parts[1].split()); px=parts[3]
raw=b''.join(b'\x00'+px[y*w*3:(y+1)*w*3] for y in range(h))
def c(t,b): return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff)
open(sys.argv[1],'wb').write(b'\x89PNG\r\n\x1a\n'+c(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+c(b'IDAT',zlib.compress(raw))+c(b'IEND',b''))
PY

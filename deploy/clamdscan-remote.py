"""Stream one file to the ClamAV daemon over its private Compose network."""

import socket
import struct
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        return 2

    path = Path(sys.argv[1])
    if not path.is_file():
        return 2

    try:
        with socket.create_connection(("clamav", 3310), timeout=10) as client:
            client.sendall(b"zINSTREAM\0")
            with path.open("rb") as source:
                while chunk := source.read(1024 * 1024):
                    client.sendall(struct.pack("!I", len(chunk)))
                    client.sendall(chunk)
            client.sendall(struct.pack("!I", 0))
            response = b""
            while not response.endswith(b"\0"):
                part = client.recv(4096)
                if not part:
                    break
                response += part
    except (OSError, struct.error):
        # Keep scanner failure distinct from a malware verdict. The API maps
        # this to 503 instead of incorrectly telling the user their file is infected.
        return 3

    result = response.rstrip(b"\0").decode("utf-8", errors="replace")
    print(result)
    if result.endswith("OK"):
        return 0
    if result.endswith("FOUND"):
        return 1
    return 3


if __name__ == "__main__":
    raise SystemExit(main())

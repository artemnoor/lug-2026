#!/bin/sh
set -eu

file=""
for argument in "$@"; do
  case "$argument" in
    /*) file="$argument" ;;
  esac
done

if [ -z "$file" ]; then
  exit 2
fi

exec python3 /app/deploy/clamdscan-remote.py "$file"

#!/bin/sh
# Fits screenshots onto the 1280x800 canvas Mozilla likes, on a dark background, numbered in the order given.
#   store/frame-screenshots.sh home.png comments.png viewer.png ...   ->   store/screenshots/01.png, 02.png, ...
# Tip: take the screenshots with the browser window about 1600x1000, so the text is still readable once scaled down.
set -e
dir="$(dirname "$0")/screenshots"
mkdir -p "$dir"
i=1
for f in "$@"; do
  out="$(printf '%s/%02d.png' "$dir" "$i")"
  magick "$f" -resize 1280x800 -background '#15181c' -gravity center -extent 1280x800 "$out"
  echo "$out"
  i=$((i + 1))
done

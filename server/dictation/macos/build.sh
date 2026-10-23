#!/bin/sh
# Builds the macOS dictation helper as a universal binary (Apple silicon + Intel) with its
# Info.plist embedded, into server/dictation/bin/colmena-dictation. Run on a Mac with the
# Xcode command line tools (GitHub Actions' macos-latest has them). electron-builder signs it
# with the app; the ad-hoc signature here only lets it run straight from the repository.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../bin"
tmp="$(mktemp -d)"
mkdir -p "$out"
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos11" \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$here/Info.plist" \
    -o "$tmp/colmena-dictation-$arch" "$here/ColmenaDictation.swift"
done
lipo -create -output "$out/colmena-dictation" "$tmp/colmena-dictation-arm64" "$tmp/colmena-dictation-x86_64"
rm -rf "$tmp"
chmod +x "$out/colmena-dictation"
codesign --force --sign - "$out/colmena-dictation"
lipo -info "$out/colmena-dictation"

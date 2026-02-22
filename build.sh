#!/bin/bash
set -e
. "$HOME/.cargo/env"

cd "$(dirname "$0")"

echo "Building release binary..."
cd src-tauri
CARGO_TARGET_DIR=target cargo build --release
cd ..

echo "Updating app bundle..."
cp src-tauri/target/release/stronglifts Stronglifts.app/Contents/MacOS/Stronglifts
cp -R Stronglifts.app /Applications/Stronglifts.app

echo "Done! Stronglifts.app has been updated in /Applications."

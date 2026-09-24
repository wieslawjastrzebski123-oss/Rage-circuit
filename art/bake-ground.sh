#!/bin/sh
# Bakes a track's ground lighting: export its layout from the game code, then light it in Blender.
#   npm run art:ground -- canyon     (default: industrial)
set -e
TRACK=${1:-industrial}
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
npx tsx art/export-track-layout.ts "$TRACK"
"$BLENDER" -b --factory-startup -P art/blender/ground_bake.py -- "$TRACK"

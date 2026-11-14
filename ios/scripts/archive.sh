#!/usr/bin/env bash
# Generates the Xcode project, archives a signed Release build and exports it for App Store Connect.
#
# Required env:
#   ASC_API_KEY_PATH    path to the App Store Connect API key (.p8)
#   ASC_API_KEY_ID      key id
#   ASC_API_ISSUER_ID   issuer id
# Optional env:
#   BUILD_NUMBER        CFBundleVersion (default: current timestamp, yyyymmddHHMM)
#   SKIP_EXPORT=1       archive only, do not export/upload
set -euo pipefail

cd "$(dirname "$0")/.."

: "${ASC_API_KEY_PATH:?set ASC_API_KEY_PATH}"
: "${ASC_API_KEY_ID:?set ASC_API_KEY_ID}"
: "${ASC_API_ISSUER_ID:?set ASC_API_ISSUER_ID}"
BUILD_NUMBER="${BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"

ARCHIVE=build/Canonico.xcarchive
EXPORT_DIR=build/export
AUTH=(-allowProvisioningUpdates
      -authenticationKeyPath "$ASC_API_KEY_PATH"
      -authenticationKeyID "$ASC_API_KEY_ID"
      -authenticationKeyIssuerID "$ASC_API_ISSUER_ID")

xcodegen generate

xcodebuild -project Canonico.xcodeproj -scheme Canonico -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  "${AUTH[@]}" archive

echo "Archived build $BUILD_NUMBER at $ARCHIVE"

if [[ "${SKIP_EXPORT:-0}" == "1" ]]; then
  exit 0
fi

cat > build/ExportOptions.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>X3G5QJ3P5A</string>
  <key>signingStyle</key><string>automatic</string>
</dict>
</plist>
EOF

xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist build/ExportOptions.plist "${AUTH[@]}"

echo "Exported and uploaded build $BUILD_NUMBER"

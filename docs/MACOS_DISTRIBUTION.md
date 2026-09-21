# macOS desktop distribution

LF CORE uses Electron only as a desktop shell. The browser build remains the same application: `npm start` still serves `index.html` and `dist/`, while Electron loads those same assets from the secure `lfcore://app` origin. Desktop-only project dialogs are exposed through a small, isolated preload bridge and are used only when that bridge exists.

## Local development

Requirements: Node.js 24 or newer and macOS.

```sh
npm install
npm run desktop
```

`npm run desktop:package` creates an unpacked, unsigned app in `out/`. `npm run desktop:make` creates unsigned DMG and ZIP files for local testing. Unsigned files are not suitable for public distribution because Gatekeeper will warn or block users.

The web application remains available with:

```sh
npm start
```

## 1. Create the Developer ID certificate

You need an active Apple Developer Program membership. This workflow distributes directly from GitHub rather than through the Mac App Store, so use a **Developer ID Application** certificate—not Apple Development or Apple Distribution.

1. Install and open Xcode, then open **Xcode → Settings → Accounts**.
2. Add the Apple Account belonging to your developer team.
3. Select the team, click **Manage Certificates**, click **+**, and choose **Developer ID Application**.
4. Open **Keychain Access → login → My Certificates**.
5. Find `Developer ID Application: …`, expand it, and confirm that a private key appears underneath.
6. Select the certificate and its private key, export them together as `lf-core-developer-id.p12`, and protect the export with a strong password.

Only the Account Holder can create a Developer ID certificate in the web portal. An existing team certificate and private key can instead be exported by the teammate who created it.

You can verify the local identity with:

```sh
security find-identity -p codesigning -v
```

## 2. Create an App Store Connect API key for notarization

1. Open [App Store Connect](https://appstoreconnect.apple.com/access/integrations/api).
2. Under **Team Keys**, create a key with **App Manager** access.
3. Record its **Key ID** and the page's **Issuer ID**.
4. Download `AuthKey_<KEY_ID>.p8`. Apple allows the private key to be downloaded only once, so store the original securely.

This key authenticates Electron Forge when it submits the signed app to Apple's notary service. It is not embedded in the app.

## 3. Add GitHub Actions secrets

In the repository, open **Settings → Secrets and variables → Actions → New repository secret**. Add these six secrets:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE_BASE64` | Base64 form of the exported `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password chosen while exporting the `.p12` |
| `APPLE_KEYCHAIN_PASSWORD` | A new random password used only for the temporary CI keychain |
| `APPLE_API_KEY_BASE64` | Base64 form of the downloaded `.p8` |
| `APPLE_API_KEY_ID` | App Store Connect Key ID |
| `APPLE_API_ISSUER` | App Store Connect Issuer ID |

On macOS, copy the two base64 values without creating extra files:

```sh
base64 -i lf-core-developer-id.p12 | pbcopy
base64 -i AuthKey_YOURKEYID.p8 | pbcopy
```

Paste each clipboard value into its matching secret. Never commit the `.p12`, `.p8`, their passwords, or their base64 forms.

## 4. Build with GitHub Actions

The `macOS release` workflow has two modes:

- **Actions → macOS release → Run workflow** builds, signs, notarizes, verifies, and retains Apple Silicon and Intel installers as workflow artifacts. It does not create a public release.
- Pushing a version tag performs the same checks and creates a GitHub Release containing both architectures.

Create a release after the desired commit is on the remote:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The tag version is applied to the package on the CI runner, so a later release can use `v0.1.1`, `v0.2.0`, and so on without editing `package.json` first. Use a new tag for every release; do not move a published tag.

The workflow runs on GitHub's native ARM64 and Intel macOS runners, imports the Developer ID certificate into an ephemeral keychain, signs with the hardened runtime, notarizes with the API key, validates the stapled ticket, and deletes the temporary key material before the runner is discarded.

## Local signed release, if needed

GitHub Actions is preferable because it makes releases reproducible. To create a signed build locally, install the Developer ID certificate in Keychain and provide the notarization key only for that command:

```sh
APPLE_SIGNING_ENABLED=true \
APPLE_API_KEY="$PWD/AuthKey_YOURKEYID.p8" \
APPLE_API_KEY_ID="YOURKEYID" \
APPLE_API_ISSUER="YOUR-ISSUER-UUID" \
npm run desktop:make -- --arch=arm64
```

Keep the API key outside this repository in normal use. Verify a distributed app or DMG with `codesign`, `spctl`, and `xcrun stapler validate`, as the GitHub workflow does automatically.

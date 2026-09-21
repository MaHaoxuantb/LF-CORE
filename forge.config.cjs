const signing = process.platform === 'darwin' && process.env.APPLE_SIGNING_ENABLED === 'true';
const notarizing = signing && process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID;

module.exports = {
  packagerConfig: {
    asar: true,
    prune: false,
    name: 'LF CORE',
    executableName: 'LF CORE',
    appBundleId: 'com.linecoflow.lfcore',
    appCategoryType: 'public.app-category.education',
    extendInfo: {
      CFBundleDisplayName: 'LF CORE',
      NSHumanReadableCopyright: `Copyright © ${new Date().getFullYear()} LinecoFlow`
    },
    ignore: [
      /^\/(?:docs|node_modules|output|src|tests|\.github)(?:\/|$)/,
      /^\/(?:agent\.md|build\.js|package-lock\.json|server\.js)(?:$)/
    ],
    ...(signing ? {
      osxSign: {
        identity: 'Developer ID Application',
        hardenedRuntime: true
      }
    } : {}),
    ...(notarizing ? {
      osxNotarize: {
        appleApiKey: process.env.APPLE_API_KEY,
        appleApiKeyId: process.env.APPLE_API_KEY_ID,
        ...(process.env.APPLE_API_ISSUER ? { appleApiIssuer: process.env.APPLE_API_ISSUER } : {})
      }
    } : {})
  },
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: { format: 'ULFO' }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin']
    }
  ]
};

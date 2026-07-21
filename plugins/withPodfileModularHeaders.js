const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// AppCheckCore (pulled in by @react-native-google-signin/google-signin's
// GoogleSignIn-iOS SDK) is a Swift pod that depends on GoogleUtilities and
// RecaptchaInterop, neither of which define modules. CocoaPods refuses to
// link that as a static library unless `use_modular_headers!` is set.
// expo-build-properties has no top-level option for this, so we patch the
// generated Podfile directly.
function withPodfileModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        'Podfile'
      );
      let contents = fs.readFileSync(podfilePath, 'utf8');

      if (!contents.includes('use_modular_headers!')) {
        contents = contents.replace(
          /(platform :ios[^\n]*\n)/,
          `$1use_modular_headers!\n`
        );
        fs.writeFileSync(podfilePath, contents);
      }

      return config;
    },
  ]);
}

module.exports = withPodfileModularHeaders;

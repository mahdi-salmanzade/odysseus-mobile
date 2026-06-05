// Explicit form of Expo's zero-config default preset. This matches what Metro
// already used implicitly, so it does NOT change the app bundle — it only gives
// jest's babel transform (jest-expo) a config file to read. babel-preset-expo
// includes the expo-router plugin and the SDK 56 RN transforms.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};

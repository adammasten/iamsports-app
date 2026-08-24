// TEMPORARY (build #30): ship without push notifications.
//
// expo-notifications auto-applies its config plugin and injects the
// `aps-environment` entitlement. Our current App Store provisioning profile
// (created 2026-05-19, before push) doesn't carry the Push Notifications
// capability, so any aps-environment entitlement breaks signing. This plugin
// strips the entitlement, letting the existing profile sign a push-free build.
// The JS push code stays installed but dormant (registerForPushNotifications
// throws without the entitlement and is caught).
//
// ORDERING: entitlement mods execute in REVERSE of app.json plugin order, so
// to run AFTER expo-notifications injects aps-environment, this plugin must be
// listed BEFORE "expo-notifications" in app.json. (Verified via prebuild.)
//
// REMOVE THIS (and this plugin entry) for build #31, once the profile is
// regenerated with the Push Notifications capability — then push activates.
const { withEntitlementsPlist } = require('@expo/config-plugins');

module.exports = function stripPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};

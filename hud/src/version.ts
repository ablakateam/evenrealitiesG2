/**
 * Single source of truth for the app version.
 *
 * Keep in lockstep with `hud/app.json`'s `version` field — that is what the
 * Even Hub portal shows and what the tester installs.
 *
 * This exists because the version used to be written in four places that
 * disagreed: app.json said 0.1.16, package.json said 0.1.0, the telemetry
 * payload hard-coded '0.1.0' (so every crash report was mislabelled) and the
 * companion hard-coded its own copy. One constant, imported everywhere.
 */
export const APP_VERSION = '0.1.23';

/** The @evenrealities/even_hub_sdk version this bundle was built against. */
export const SDK_VERSION = '0.0.14';

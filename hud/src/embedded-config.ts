/**
 * Build-time configuration baked in from hud/.env.
 *
 * Vite inlines `import.meta.env.VITE_*` at build time, so once `pack.sh` has
 * produced a `.ehpk` the values live in the bundle as plain strings. This is
 * acceptable for Private/Beta-track single-tenant builds (the .ehpk is only
 * downloadable by the developer's own portal account); it is NOT acceptable
 * for a public Production release, where we replace this with a proper
 * pairing flow.
 *
 * Both fields are optional: if either is missing, the HUD falls back to
 * KVS-driven pairing (URL bootstrap or the "Not Paired" screen).
 */
export interface EmbeddedConfig {
  server: string | null;
  secret: string | null;
  /**
   * The ONE origin this build is allowed to reach, as a complete literal
   * (e.g. "https://vox.example.com").
   *
   * Not a secret — it is the same value that goes into `app.json`'s network
   * whitelist, which is published in the package anyway. It is baked in as a
   * whole string rather than assembled at runtime for two reasons: the Even
   * Realities App blocks any request to a domain the manifest does not list
   * (wildcards are unsupported), and store review statically scans the bundle
   * for URL literals it cannot match against the whitelist. A template like
   * `https://${host}` minifies to `https://${t}` and is flagged as an
   * uncoverable URL — correctly, since a scanner cannot know what it resolves
   * to.
   */
  allowedOrigin: string | null;
}

export const EMBEDDED_CONFIG: EmbeddedConfig = {
  server: import.meta.env.VITE_VOX_SERVER ?? null,
  secret: import.meta.env.VITE_VOX_SECRET ?? null,
  allowedOrigin: import.meta.env.VITE_VOX_ALLOWED_ORIGIN ?? null,
};

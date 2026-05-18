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
}

export const EMBEDDED_CONFIG: EmbeddedConfig = {
  server: import.meta.env.VITE_VOX_SERVER ?? null,
  secret: import.meta.env.VITE_VOX_SECRET ?? null,
};

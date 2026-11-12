import { join } from "node:path";

// A refused local port: a registry request fails at once instead of waiting on a timeout.
const NO_REGISTRY = "http://127.0.0.1:9/";

/**
 * The environment of a run that must not go online: every package manager points at no
 * registry, and its caches at empty dirs under `tmp`, so nothing comes from this machine's
 * own caches either.
 */
export function offlineEnv(tmp: string): Record<string, string> {
  return {
    GOPROXY: "off",
    GOTOOLCHAIN: "local",
    // Go extracts modules read-only; writable ones let cleanupFixture remove what a run fetched.
    GOFLAGS: "-modcacherw",
    GOMODCACHE: join(tmp, "gomodcache"),
    npm_config_registry: NO_REGISTRY,
    // npm retries a refused fetch with a back-off of ten seconds and more; one try is enough.
    npm_config_fetch_retries: "0",
    npm_config_cache: join(tmp, "npm-cache"),
    BUN_CONFIG_REGISTRY: NO_REGISTRY,
    BUN_INSTALL_CACHE_DIR: join(tmp, "bun-cache"),
    UV_INDEX_URL: NO_REGISTRY,
    UV_CACHE_DIR: join(tmp, "uv-cache"),
    UV_OFFLINE: "1",
    PIP_INDEX_URL: NO_REGISTRY,
    PIP_NO_INDEX: "1",
  };
}

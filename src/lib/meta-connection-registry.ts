export const MAX_META_SYSTEM_USER_CONNECTIONS = 64;
/**
 * Meta Business Suite currently caps the total asset assignments of one system
 * user at 300. Ad accounts consume that allowance together with other assigned
 * asset types, so this is not a guaranteed ad-account-only capacity.
 */
export const MAX_META_ASSET_ASSIGNMENTS_PER_SYSTEM_USER = 300;

const CONNECTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export type MetaSystemUserConnection = Readonly<{
  id: string;
  accessToken: string;
}>;

export type MetaSystemUserConnectionRegistry = Readonly<{
  mode: "legacy-single" | "system-user-pool";
  connections: readonly MetaSystemUserConnection[];
}>;

/**
 * A display-safe overview of the currently configured system-user topology.
 *
 * Connection identifiers and access tokens intentionally do not cross this
 * boundary. The value is suitable for an SSO-protected operator page only.
 */
export type MetaSystemUserTopologySummary = Readonly<{
  mode: MetaSystemUserConnectionRegistry["mode"];
  configuredSystemUserCount: number;
  nominalAdAccountCapacityAtZeroOtherAssets: number;
  perSystemUserTotalAssetLimit: typeof MAX_META_ASSET_ASSIGNMENTS_PER_SYSTEM_USER;
}>;

export class MetaConnectionConfigurationError extends Error {
  constructor() {
    super("Invalid Meta system user connection configuration.");
    this.name = "MetaConnectionConfigurationError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

function invalidConfiguration(): never {
  throw new MetaConnectionConfigurationError();
}

function parseConnection(value: unknown): MetaSystemUserConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidConfiguration();
  }

  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const accessToken =
    typeof candidate.accessToken === "string"
      ? candidate.accessToken.trim()
      : "";

  if (!CONNECTION_ID_PATTERN.test(id) || !accessToken) {
    return invalidConfiguration();
  }

  return Object.freeze({ id, accessToken });
}

/**
 * Resolves server-only system-user credentials without exposing tokens, account
 * IDs, or connection IDs to callers outside the data-access layer.
 *
 * The JSON pool is the preferred production topology. The legacy variable is
 * retained only to avoid a forced cutover while the operator creates bounded
 * system-user buckets.
 */
export function resolveMetaSystemUserConnections(
  environment: Environment = process.env,
): MetaSystemUserConnectionRegistry {
  const configuredPool = environment.META_SYSTEM_USER_CONNECTIONS_JSON?.trim();

  if (!configuredPool) {
    const accessToken = environment.META_SYSTEM_USER_ACCESS_TOKEN?.trim();

    if (!accessToken) {
      return invalidConfiguration();
    }

    return Object.freeze({
      mode: "legacy-single",
      connections: Object.freeze([
        Object.freeze({ id: "legacy", accessToken }),
      ]),
    });
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(configuredPool);
  } catch {
    return invalidConfiguration();
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_META_SYSTEM_USER_CONNECTIONS) {
    return invalidConfiguration();
  }

  const seenIds = new Set<string>();
  const connections = parsed.map((entry) => {
    const connection = parseConnection(entry);

    if (seenIds.has(connection.id)) {
      return invalidConfiguration();
    }

    seenIds.add(connection.id);
    return connection;
  });

  return Object.freeze({
    mode: "system-user-pool",
    connections: Object.freeze(connections),
  });
}

/**
 * Returns capacity math only. It never exposes connection IDs or credentials
 * and does not inspect or change any Meta Business Suite assignment.
 */
export function getMetaSystemUserTopologySummary(
  environment: Environment = process.env,
): MetaSystemUserTopologySummary {
  const registry = resolveMetaSystemUserConnections(environment);

  return Object.freeze({
    mode: registry.mode,
    configuredSystemUserCount: registry.connections.length,
    nominalAdAccountCapacityAtZeroOtherAssets:
      registry.connections.length * MAX_META_ASSET_ASSIGNMENTS_PER_SYSTEM_USER,
    perSystemUserTotalAssetLimit: MAX_META_ASSET_ASSIGNMENTS_PER_SYSTEM_USER,
  });
}

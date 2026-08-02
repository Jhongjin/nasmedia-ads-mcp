import assert from "node:assert/strict";

import {
  MAX_META_SYSTEM_USER_CONNECTIONS,
  MetaConnectionConfigurationError,
  resolveMetaSystemUserConnections,
} from "../src/lib/meta-connection-registry.ts";

function expectInvalidConfiguration(environment) {
  assert.throws(
    () => resolveMetaSystemUserConnections(environment),
    MetaConnectionConfigurationError,
  );
}

const legacy = resolveMetaSystemUserConnections({
  META_SYSTEM_USER_ACCESS_TOKEN: "test-legacy-token",
});

assert.equal(legacy.mode, "legacy-single");
assert.equal(legacy.connections.length, 1);
assert.equal(legacy.connections[0]?.id, "legacy");

const pooled = resolveMetaSystemUserConnections({
  META_SYSTEM_USER_ACCESS_TOKEN: "test-legacy-token-that-must-not-be-selected",
  META_SYSTEM_USER_CONNECTIONS_JSON: JSON.stringify([
    { id: "pool_01", accessToken: "test-pool-token-1" },
    { id: "pool_02", accessToken: "test-pool-token-2" },
  ]),
});

assert.equal(pooled.mode, "system-user-pool");
assert.equal(pooled.connections.length, 2);
assert.deepEqual(
  pooled.connections.map((connection) => connection.id),
  ["pool_01", "pool_02"],
);

const sixteenPoolScale = resolveMetaSystemUserConnections({
  META_SYSTEM_USER_CONNECTIONS_JSON: JSON.stringify(
    Array.from({ length: 16 }, (_, index) => ({
      id: `pool_${String(index + 1).padStart(2, "0")}`,
      accessToken: "test-scale-token",
    })),
  ),
});

assert.equal(sixteenPoolScale.mode, "system-user-pool");
assert.equal(sixteenPoolScale.connections.length, 16);

expectInvalidConfiguration({});
expectInvalidConfiguration({
  META_SYSTEM_USER_CONNECTIONS_JSON: "not-json",
});
expectInvalidConfiguration({
  META_SYSTEM_USER_CONNECTIONS_JSON: JSON.stringify([
    { id: "duplicate", accessToken: "test-pool-token-1" },
    { id: "duplicate", accessToken: "test-pool-token-2" },
  ]),
});
expectInvalidConfiguration({
  META_SYSTEM_USER_CONNECTIONS_JSON: JSON.stringify(
    Array.from({ length: MAX_META_SYSTEM_USER_CONNECTIONS + 1 }, (_, index) => ({
      id: `pool_${index}`,
      accessToken: "test-pool-token",
    })),
  ),
});

console.log(JSON.stringify({
  legacyCompatibilityPassed: true,
  pooledRegistryPassed: true,
  sixteenSystemUserScaleConfigurationPassed: true,
  malformedConfigurationRejected: true,
  duplicateConnectionRejected: true,
  oversizedPoolRejected: true,
  tokenValuePrinted: false,
}));

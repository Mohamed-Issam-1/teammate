export const TEST_DATABASE_CONTEXT_ENV = "AUTH_INTEGRATION_TEST_CONTEXT";
export const TEST_DATABASE_CONTEXT_VALUE = "auth-core-integration";

export type TestDatabaseEnvironment = Record<string, string | undefined>;

export type SafeTestDatabase = {
  testDatabaseUrl: string;
};

type ParsedPostgresTarget = {
  databaseName: string;
  effectivePort: string;
  hostname: string;
  normalizedTarget: string;
};

type RawAuthority = {
  effectivePort: string;
  hostname: string;
  pathStart: number;
};

const DEFAULT_POSTGRES_PORT = "5432";
const SUPPORTED_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_]+$/;
const RAW_DATABASE_PATH_PATTERN = /^\/[A-Za-z0-9_]+$/;
const RAW_HOSTNAME_PATTERN =
  /^(?:(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*|\[[A-Fa-f0-9:.]+\])$/;
const WHITESPACE_OR_CONTROL_PATTERN = /[\u0000-\u0020\u007f]/;

function fail(message: string): never {
  throw new Error(`Unsafe integration test database configuration: ${message}`);
}

function requireExplicitEnvironmentValue(
  environment: TestDatabaseEnvironment,
  variableName: "DATABASE_URL" | "TEST_DATABASE_URL",
): string {
  const isOwnProperty = Object.prototype.hasOwnProperty.call(
    environment,
    variableName,
  );
  const value = environment[variableName];

  if (!isOwnProperty || typeof value !== "string" || value.length === 0) {
    fail(`${variableName} is required as an explicit environment value`);
  }

  return value;
}

function rawAuthority(value: string, variableName: string): RawAuthority {
  const authorityStart = value.indexOf("://") + 3;
  const pathStart = value.indexOf("/", authorityStart);

  if (pathStart < 0) {
    fail(`${variableName} must include one simple database path`);
  }

  const authority = value.slice(authorityStart, pathStart);
  const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
  let hostname: string;
  let port: string;
  let hasExplicitPort: boolean;

  if (hostAndPort.startsWith("[")) {
    const closingBracket = hostAndPort.indexOf("]");
    if (closingBracket < 0) {
      fail(`${variableName} must include one simple literal hostname`);
    }

    hostname = hostAndPort.slice(0, closingBracket + 1);
    const portSuffix = hostAndPort.slice(closingBracket + 1);
    hasExplicitPort = portSuffix.length > 0;
    if (hasExplicitPort && !portSuffix.startsWith(":")) {
      fail(`${variableName} must include one simple literal hostname and port`);
    }
    port = hasExplicitPort ? portSuffix.slice(1) : "";
  } else {
    const portSeparator = hostAndPort.lastIndexOf(":");
    hasExplicitPort = portSeparator >= 0;
    hostname = hasExplicitPort
      ? hostAndPort.slice(0, portSeparator)
      : hostAndPort;
    port = hasExplicitPort ? hostAndPort.slice(portSeparator + 1) : "";
  }

  if (
    hostname.length > 253 ||
    !RAW_HOSTNAME_PATTERN.test(hostname) ||
    (hasExplicitPort && port !== DEFAULT_POSTGRES_PORT)
  ) {
    fail(
      `${variableName} must use a literal hostname and only port 5432 when explicit`,
    );
  }

  return {
    effectivePort: hasExplicitPort ? port : DEFAULT_POSTGRES_PORT,
    hostname,
    pathStart,
  };
}

function rawDatabasePath(
  value: string,
  variableName: string,
  pathStart: number,
): string {
  const pathname = value.slice(pathStart);
  if (!RAW_DATABASE_PATH_PATTERN.test(pathname)) {
    fail(
      `${variableName} database path must be one unencoded name matching ${DATABASE_NAME_PATTERN.source}`,
    );
  }

  return pathname;
}

/**
 * Parse only the small PostgreSQL URL shape accepted by destructive auth tests.
 *
 * This intentionally does not normalize libpq options, encoded paths, aliases,
 * or other connection-string features. Rejecting uncertainty is safer than
 * guessing which database a complex URL will ultimately address.
 */
function parsePostgresUrl(
  variableName: "DATABASE_URL" | "TEST_DATABASE_URL",
  value: string,
): ParsedPostgresTarget {
  if (WHITESPACE_OR_CONTROL_PATTERN.test(value)) {
    fail(`${variableName} must not contain whitespace or control characters`);
  }

  if (value.includes("?")) {
    fail(`${variableName} must not include query or search parameters`);
  }

  if (value.includes("#")) {
    fail(`${variableName} must not include a URL fragment`);
  }

  if (value.includes("\\")) {
    fail(`${variableName} must use one simple PostgreSQL URL path`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(`${variableName} must be a valid PostgreSQL URL`);
  }

  if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
    fail(`${variableName} must use the postgres: or postgresql: protocol`);
  }

  if (!url.hostname) {
    fail(`${variableName} must include a host`);
  }

  const authority = rawAuthority(value, variableName);
  if (url.port && url.port !== authority.effectivePort) {
    fail(`${variableName} port must not be normalized`);
  }

  const pathname = rawDatabasePath(value, variableName, authority.pathStart);
  if (url.pathname !== pathname) {
    fail(`${variableName} database path must not be normalized or encoded`);
  }

  const databaseName = pathname.slice(1);
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    fail(
      `${variableName} database name must match ${DATABASE_NAME_PATTERN.source}`,
    );
  }

  const normalizedHostname = authority.hostname.toLowerCase();
  const normalizedTarget = `postgresql://${normalizedHostname}:${authority.effectivePort}/${databaseName}`;

  return {
    databaseName,
    effectivePort: authority.effectivePort,
    hostname: normalizedHostname,
    normalizedTarget,
  };
}

/**
 * Fail-closed guard for every operation against the integration-test database.
 *
 * Callers pass the integration process environment directly. Both URLs must be
 * explicit, simple, same-host/same-port targets whose database names differ;
 * TEST_DATABASE_URL must additionally end in the exact suffix `_test`.
 * Errors identify only environment variables, never connection values.
 */
export function assertSafeTestDatabaseEnvironment(
  environment: TestDatabaseEnvironment,
): SafeTestDatabase {
  if (environment.NODE_ENV !== "test") {
    fail("NODE_ENV must be exactly test");
  }

  if (environment[TEST_DATABASE_CONTEXT_ENV] !== TEST_DATABASE_CONTEXT_VALUE) {
    fail(
      `${TEST_DATABASE_CONTEXT_ENV} must identify the auth integration suite`,
    );
  }

  const developmentUrl = requireExplicitEnvironmentValue(
    environment,
    "DATABASE_URL",
  );
  const testUrl = requireExplicitEnvironmentValue(
    environment,
    "TEST_DATABASE_URL",
  );
  const developmentTarget = parsePostgresUrl("DATABASE_URL", developmentUrl);
  const testTarget = parsePostgresUrl("TEST_DATABASE_URL", testUrl);

  if (developmentTarget.hostname !== testTarget.hostname) {
    fail(
      "DATABASE_URL and TEST_DATABASE_URL hostnames must match exactly after lowercase normalization",
    );
  }

  if (developmentTarget.effectivePort !== testTarget.effectivePort) {
    fail(
      "DATABASE_URL and TEST_DATABASE_URL effective ports must match exactly",
    );
  }

  if (!testTarget.databaseName.endsWith("_test")) {
    fail("TEST_DATABASE_URL database name must end in _test");
  }

  if (developmentTarget.databaseName === testTarget.databaseName) {
    fail(
      "TEST_DATABASE_URL must use a database name different from DATABASE_URL",
    );
  }

  if (developmentTarget.normalizedTarget === testTarget.normalizedTarget) {
    fail(
      "TEST_DATABASE_URL normalized effective target must differ from DATABASE_URL",
    );
  }

  return { testDatabaseUrl: testUrl };
}

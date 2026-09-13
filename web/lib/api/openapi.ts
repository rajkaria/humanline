/**
 * OpenAPI 3.1 description of the public read API. Served at `/api/openapi.json` and rendered at
 * `/api`. `test/api-openapi.test.ts` checks every documented path has a route and the examples match
 * the shapes `lib/api/v1.ts` returns.
 */

const profileParam = {
  name: "profile",
  in: "query",
  required: false,
  description: "`staging` (World's Sepolia staging tree, the default) or `production` (Ethereum mainnet Orb tree).",
  schema: { type: "string", enum: ["staging", "production"], default: "staging" },
} as const;

const line = {
  type: "object",
  required: ["exists", "limit", "principal", "available", "dueAt", "openedAt", "loansRepaid", "loansLate", "frozen", "inDefault", "decimals"],
  properties: {
    exists: { type: "boolean", description: "The human has opened a line." },
    limit: { type: "string", description: "Credit limit in hUSD base units (6 decimals), decimal string." },
    principal: { type: "string", description: "Owed now, fee included." },
    available: { type: "string", description: "What the human can still draw." },
    dueAt: { type: ["integer", "null"], description: "Unix seconds the current loan is due." },
    openedAt: { type: ["integer", "null"] },
    loansRepaid: { type: "integer" },
    loansLate: { type: "integer" },
    frozen: { type: "boolean", description: "Defaulted; frozen on every wallet the human ever holds." },
    inDefault: { type: "boolean" },
    decimals: { type: "integer", const: 6 },
  },
} as const;

const error = {
  type: "object",
  required: ["error", "message"],
  properties: { error: { type: "string" }, message: { type: "string" } },
} as const;

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Humanline public API",
    version: "1.0.0",
    description:
      "Read-only answers to \"is this wallet a verified human\" and \"what is this human's credit line\" on Creditcoin CC3 testnet. Every value is read from the contracts at request time. CORS is open; 60 requests a minute per IP.",
    license: { name: "MIT" },
  },
  servers: [{ url: "https://humanline.credit" }],
  paths: {
    "/api/v1/human/{address}": {
      get: {
        operationId: "getHuman",
        summary: "Personhood and credit for a wallet",
        parameters: [
          { name: "address", in: "path", required: true, description: "EVM address, any casing.", schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } },
          profileParam,
        ],
        responses: {
          "200": {
            description: "The wallet's status. `isHuman` false means the other fields are null.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["version", "profile", "address", "isHuman", "nullifier", "registeredAt", "line", "registry"],
                  properties: {
                    version: { type: "string" },
                    profile: { type: "string", enum: ["staging", "production"] },
                    address: { type: "string" },
                    isHuman: { type: "boolean" },
                    nullifier: { type: ["string", "null"], description: "World ID nullifier, 32-byte hex." },
                    registeredAt: { type: ["integer", "null"], description: "Unix seconds of first registration, kept across wallet moves." },
                    line: { oneOf: [line, { type: "null" }] },
                    registry: { type: "string" },
                  },
                },
                example: {
                  version: "1.0.0",
                  profile: "staging",
                  address: "0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3",
                  registry: "0x62c2fd99ea587e4b466175ad248468782bd5298d",
                  isHuman: true,
                  nullifier: "0x06d6d24ba1cb97b3d3456e9a3bdfc4f707072ecd96e79998dfb7dce49529b6d4",
                  registeredAt: 1789205280,
                  line: {
                    exists: true,
                    limit: "39062500",
                    principal: "0",
                    available: "39062500",
                    dueAt: 1789248585,
                    openedAt: 1789247835,
                    loansRepaid: 2,
                    loansLate: 0,
                    frozen: false,
                    inDefault: false,
                    decimals: 6,
                  },
                },
              },
            },
          },
          "400": { description: "Malformed address or profile.", content: { "application/json": { schema: error } } },
          "429": { description: "Rate limited." },
          "502": { description: "The chain read failed.", content: { "application/json": { schema: error } } },
        },
      },
    },
    "/api/v1/line/{nullifier}": {
      get: {
        operationId: "getLine",
        summary: "A human's credit line by World ID nullifier",
        parameters: [
          { name: "nullifier", in: "path", required: true, description: "Decimal, or 0x-prefixed hex up to 32 bytes.", schema: { type: "string" } },
          profileParam,
        ],
        responses: {
          "200": {
            description: "The line and the wallet the human holds today (null when the nullifier is unknown).",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["version", "profile", "nullifier", "wallet", "line", "creditLine"],
                  properties: {
                    version: { type: "string" },
                    profile: { type: "string", enum: ["staging", "production"] },
                    nullifier: { type: "string" },
                    wallet: { type: ["string", "null"] },
                    line,
                    creditLine: { type: "string" },
                  },
                },
                example: {
                  version: "1.0.0",
                  profile: "staging",
                  nullifier: "0x06d6d24ba1cb97b3d3456e9a3bdfc4f707072ecd96e79998dfb7dce49529b6d4",
                  wallet: "0x45B9c98bc6Dbe96a8Ee470743637e6A0e36dCCA3",
                  line: {
                    exists: true,
                    limit: "39062500",
                    principal: "0",
                    available: "39062500",
                    dueAt: 1789248585,
                    openedAt: 1789247835,
                    loansRepaid: 2,
                    loansLate: 0,
                    frozen: false,
                    inDefault: false,
                    decimals: 6,
                  },
                  creditLine: "0x49d5f2ea387a4ee16eef3cf390fccfa689dda2b9",
                },
              },
            },
          },
          "400": { description: "Malformed nullifier or profile.", content: { "application/json": { schema: error } } },
          "429": { description: "Rate limited." },
          "502": { description: "The chain read failed.", content: { "application/json": { schema: error } } },
        },
      },
    },
    "/api/v1/feed": {
      get: {
        operationId: "getFeed",
        summary: "Loan lifecycle feed",
        parameters: [
          profileParam,
          { name: "human", in: "query", required: false, description: "Only this human's events (nullifier, decimal or hex).", schema: { type: "string" } },
          { name: "limit", in: "query", required: false, description: "Newest N events, 1 to 500 (default 200).", schema: { type: "integer", minimum: 1, maximum: 500 } },
        ],
        responses: {
          "200": {
            description:
              "Every line opened, loan drawn, repayment, limit change and default, keyed by the human, newest first. Rebuilt from CreditLine events.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["version", "profile", "creditLine", "decimals", "items", "fromBlock", "toBlock"],
                  properties: {
                    version: { type: "string" },
                    profile: { type: "string", enum: ["staging", "production"] },
                    creditLine: { type: "string" },
                    decimals: { type: "integer", const: 6 },
                    fromBlock: { type: "integer" },
                    toBlock: { type: "integer" },
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["id", "type", "human", "wallet", "block", "txHash", "logIndex", "data"],
                        properties: {
                          id: { type: "string" },
                          type: { type: "string", enum: ["line.opened", "loan.drawn", "loan.repaid", "limit.changed", "loan.defaulted"] },
                          human: { type: "string" },
                          wallet: { type: ["string", "null"] },
                          block: { type: "integer" },
                          txHash: { type: "string" },
                          logIndex: { type: "integer" },
                          data: { type: "object" },
                        },
                      },
                    },
                  },
                },
                example: {
                  version: "1.0.0",
                  profile: "staging",
                  creditLine: "0x49d5f2ea387a4ee16eef3cf390fccfa689dda2b9",
                  decimals: 6,
                  fromBlock: 5477098,
                  toBlock: 5479709,
                  items: [
                    {
                      id: "0x…:3",
                      type: "limit.changed",
                      human: "0x06d6d24ba1cb97b3d3456e9a3bdfc4f707072ecd96e79998dfb7dce49529b6d4",
                      wallet: null,
                      block: 5477126,
                      txHash: "0x…",
                      logIndex: 3,
                      data: { oldLimit: "31250000", newLimit: "39062500", onTime: true },
                    },
                  ],
                },
              },
            },
          },
          "400": { description: "Malformed profile or human.", content: { "application/json": { schema: error } } },
          "429": { description: "Rate limited." },
          "502": { description: "The chain read failed.", content: { "application/json": { schema: error } } },
        },
      },
    },
  },
} as const;

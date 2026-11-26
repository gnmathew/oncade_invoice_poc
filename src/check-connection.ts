// Setup check (design doc step 13.7):
//   docker compose exec app npm run check-connection
// Calls GET /v1/platform/me and prints a short summary. Never prints the key or secret.
import { config } from "./config";
import { getMe, OncadeError } from "./oncade";

// Permissions the app needs (design doc step 13.3).
const NEEDED_SCOPES = [
  "platform:read",
  "invoice:create",
  "invoice:read",
  "invoice:send",
  "invoice:cancel",
  "invoice:update",
  "business:read",
];

function list(values: string[] | undefined): string {
  if (!values) return "(not in reply)";
  return values.length ? values.join(", ") : "none";
}

async function main(): Promise<void> {
  console.log("Checking the connection to Oncade...\n");

  const me = await getMe();
  const environment = me.keyInfo?.environment;
  const activeScopes = me.keyInfo?.activeScopes;

  let businessLine = me.businessId ?? "(not in reply)";
  if (me.businessId) {
    businessLine +=
      me.businessId === config.ONCADE_BUSINESS_ID
        ? "  (matches ONCADE_BUSINESS_ID in .env ✓)"
        : "  (does NOT match ONCADE_BUSINESS_ID in .env ✗)";
  }

  console.log(`  environment:     ${environment ?? "(not in reply)"}`);
  console.log(`  platform id:     ${me.platformId ?? "(not in reply)"}`);
  console.log(`  platform status: ${me.status ?? "(not in reply)"}`);
  console.log(`  business id:     ${businessLine}`);
  console.log(`  active scopes:   ${list(activeScopes)}`);
  console.log(`  pending scopes:  ${list(me.pendingScopes)}`);
  // A key can only use scopes that are BOTH approved for the platform AND requested by the key.
  console.log(`  platform approved scopes: ${list(me.approvedScopes)}`);
  console.log(`  key requested scopes:     ${list(me.keyInfo?.requestedScopes)}`);

  // Warnings
  const warnings: string[] = [];
  if (environment && environment !== "test") {
    warnings.push(`The key's environment is "${environment}", not "test".`);
  }
  if (activeScopes) {
    const missing = NEEDED_SCOPES.filter((scope) => !activeScopes.includes(scope));
    if (missing.length) warnings.push(`Missing permissions: ${missing.join(", ")}`);
  }
  if (!me.businessId) {
    // The docs say /me returns businessId. If it doesn't, show what it did return (field names only).
    warnings.push(`No businessId in the reply. Fields returned: ${Object.keys(me).join(", ")}`);
  }

  if (warnings.length) {
    console.log("\n⚠️  Warnings:");
    for (const warning of warnings) console.log(`  - ${warning}`);
  } else {
    console.log("\n✅ Connection OK");
  }
}

main().catch((err: unknown) => {
  console.error("\n❌ Connection check failed");
  console.error(`  ${err instanceof Error ? err.message : String(err)}`);

  if (err instanceof OncadeError) {
    if (err.status === 401) console.error("  Hint: Oncade doesn't accept the key. Check ONCADE_API_KEY in .env.");
    if (err.status === 403) console.error("  Hint: the key is missing a permission (needs platform:read).");
    if (err.status === 0) console.error("  Hint: Oncade couldn't be reached. Check the internet connection.");
  }
  process.exitCode = 1;
});

export function requireEnvironment(name: "DATABASE_URL" | "SSO_CLIENT_ID" | "SESSION_ENCRYPTION_KEY") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

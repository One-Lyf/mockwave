// Build-time guard: VITE_KITDEMO_STACK_KEY is inlined into the public bundle,
// so it must never be a service key. Throws on an `sb_secret_` key or on a JWT
// whose payload role is `service_role`. The JWT payload is decoded (base64url)
// only; the signature is not verified. Empty, missing, publishable and anon
// keys pass.

function jwtRole(token: string): unknown {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { role?: unknown } | null;
    return payload && typeof payload === 'object' ? payload.role : undefined;
  } catch {
    return undefined;
  }
}

export function assertKitdemoKeySafe(key: string | undefined): void {
  const k = (key ?? '').trim();
  if (!k) return;
  if (k.startsWith('sb_secret_') || jwtRole(k) === 'service_role') {
    throw new Error(
      'VITE_KITDEMO_STACK_KEY is a service key. It would be baked into the public bundle. ' +
        'Use a publishable or anon key.',
    );
  }
}

// Build-time guard: VITE_KITDEMO_STACK_KEY is inlined into the public bundle,
// so it must never be a service key. The value is normalised first (every character
// outside base64url, `+/=` and dots is dropped) so paste mistakes cannot hide a
// key: wrapped quotes, backslash continuations, a whole `NAME=value` line, whitespace inside a JWT.
// Throws when `sb_secret_` appears anywhere, or when any dot-separated segment
// decodes (base64url, signature never verified) to an object whose `role` is
// present and not exactly `anon`. Empty, missing, publishable and anon pass.

function segmentRole(segment: string): unknown {
  try {
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const obj = JSON.parse(atob(padded)) as Record<string, unknown> | null;
    if (obj && typeof obj === 'object' && 'role' in obj) return obj.role;
  } catch {
    // not a decodable segment
  }
  return undefined;
}

export function assertKitdemoKeySafe(key: string | undefined): void {
  const k = (key ?? '').replace(/[^A-Za-z0-9_+/=.-]+/g, '');
  if (!k) return;
  const bad =
    k.includes('sb_secret_') ||
    k.split('.').some((seg) => {
      const role = segmentRole(seg);
      return role !== undefined && role !== 'anon';
    });
  if (bad) {
    throw new Error(
      'VITE_KITDEMO_STACK_KEY is a service key. It would be baked into the public bundle. ' +
        'Use a publishable or anon key.',
    );
  }
}

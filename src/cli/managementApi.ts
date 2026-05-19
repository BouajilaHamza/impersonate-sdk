const API_BASE = "https://api.supabase.com/v1";

export interface ApiOptions {
  accessToken: string;
  projectRef: string;
}

async function call(
  method: string,
  path: string,
  opts: { accessToken: string },
  body?: unknown
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function verifyAccess(opts: ApiOptions): Promise<boolean> {
  const res = await call("GET", `/projects/${opts.projectRef}`, opts);
  return res.ok;
}

export async function pushSecrets(
  env: Record<string, string>,
  opts: ApiOptions
): Promise<void> {
  const payload = Object.entries(env).map(([name, value]) => ({ name, value }));
  const res = await call("POST", `/projects/${opts.projectRef}/secrets`, opts, payload);
  if (!res.ok) {
    throw new Error(`secrets push failed (${res.status}): ${await res.text()}`);
  }
}

export async function deployFunction(
  slug: string,
  source: string,
  opts: ApiOptions & { verifyJwt?: boolean }
): Promise<void> {
  const verifyJwt = opts.verifyJwt ?? true;

  const existing = await call("GET", `/projects/${opts.projectRef}/functions/${slug}`, opts);

  if (existing.ok) {
    const res = await call(
      "PATCH",
      `/projects/${opts.projectRef}/functions/${slug}`,
      opts,
      { body: source, verify_jwt: verifyJwt }
    );
    if (!res.ok) {
      throw new Error(`function update failed (${res.status}): ${await res.text()}`);
    }
    return;
  }

  if (existing.status !== 404) {
    throw new Error(
      `unexpected status checking function existence (${existing.status}): ${await existing.text()}`
    );
  }

  const res = await call(
    "POST",
    `/projects/${opts.projectRef}/functions`,
    opts,
    { slug, name: slug, body: source, verify_jwt: verifyJwt }
  );
  if (!res.ok) {
    throw new Error(`function create failed (${res.status}): ${await res.text()}`);
  }
}

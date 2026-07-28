import jwt from "jsonwebtoken";

export function createAppJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    },
    privateKey,
    { algorithm: "RS256" },
  );
}

export interface InstallationToken {
  token: string;
  expiresAt: Date;
}

export async function fetchInstallationToken(
  appJwt: string,
  installationId: string,
  fetchFn: typeof fetch = fetch,
): Promise<InstallationToken> {
  const res = await fetchFn(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!res.ok) {
    throw new Error(
      `Failed to fetch installation token: ${res.status} ${await res.text()}`,
    );
  }

  const data = await res.json();
  return { token: data.token, expiresAt: new Date(data.expires_at) };
}

export function createInstallationTokenProvider(
  appId: string,
  privateKey: string,
  installationId: string,
  deps: {
    fetchToken?: typeof fetchInstallationToken;
    createJwt?: typeof createAppJWT;
  } = {},
): { getToken(): Promise<string> } {
  const fetchToken = deps.fetchToken ?? fetchInstallationToken;
  const createJwt = deps.createJwt ?? createAppJWT;
  let cached: InstallationToken | null = null;

  return {
    async getToken(): Promise<string> {
      if (cached && cached.expiresAt.getTime() - Date.now() > 60_000) {
        return cached.token;
      }
      const appJwt = createJwt(appId, privateKey);
      cached = await fetchToken(appJwt, installationId);
      return cached.token;
    },
  };
}

/**
 * Minimal GitHub REST client (ARCHITECTURE §3–4). The only network calls the app makes go to
 * api.github.com. Tokens, amounts and descriptions never go into URLs or logs.
 */
export const API = 'https://api.github.com';

export interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
}

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

type FetchLike = typeof fetch;

const enc = encodeURIComponent;

export class GitHub {
  private token: string;
  private ref: RepoRef;
  private fetchImpl: FetchLike;

  constructor(token: string, ref: RepoRef, fetchImpl: FetchLike = (...a) => fetch(...a)) {
    this.token = token;
    this.ref = ref;
    this.fetchImpl = fetchImpl;
  }

  private repoPath(): string {
    return `/repos/${enc(this.ref.owner)}/${enc(this.ref.repo)}`;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(API + path, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
    } catch {
      throw new GitHubError(0, 'Network error: you may be offline.');
    }
    if (!res.ok) {
      let msg = `GitHub answered ${res.status}`;
      if (res.status === 401) msg = 'The token was rejected (expired or revoked?).';
      else if (res.status === 403)
        msg = 'The token lacks permission (Contents: read and write) or hit a rate limit.';
      else if (res.status === 404) msg = 'Repository or branch not found, or the token cannot see it.';
      else if (res.status === 409) msg = 'The repository is empty.';
      throw new GitHubError(res.status, msg);
    }
    return (await res.json()) as T;
  }

  getRepo() {
    return this.request<{
      full_name: string;
      private: boolean;
      default_branch: string;
      permissions?: { push?: boolean };
    }>('GET', this.repoPath());
  }

  async getHeadSha(): Promise<string> {
    const r = await this.request<{ object: { sha: string } }>(
      'GET',
      `${this.repoPath()}/git/ref/heads/${enc(this.ref.branch)}`,
    );
    return r.object.sha;
  }

  async getCommitTreeSha(commitSha: string): Promise<string> {
    const c = await this.request<{ tree: { sha: string } }>(
      'GET',
      `${this.repoPath()}/git/commits/${commitSha}`,
    );
    return c.tree.sha;
  }

  async getTree(sha: string): Promise<{ tree: TreeEntry[]; truncated: boolean }> {
    return this.request('GET', `${this.repoPath()}/git/trees/${sha}?recursive=1`);
  }

  async getBlobText(sha: string): Promise<string> {
    const b = await this.request<{ content: string; encoding: string }>(
      'GET',
      `${this.repoPath()}/git/blobs/${sha}`,
    );
    if (b.encoding !== 'base64') return b.content;
    return decodeBase64Utf8(b.content);
  }

  // ---- writes (Git Data API), used by the pending-ops flusher ----

  async createBlob(text: string): Promise<string> {
    const r = await this.request<{ sha: string }>('POST', `${this.repoPath()}/git/blobs`, {
      content: encodeBase64Utf8(text),
      encoding: 'base64',
    });
    return r.sha;
  }

  async createTree(baseTree: string, entries: { path: string; sha: string }[]): Promise<string> {
    const r = await this.request<{ sha: string }>('POST', `${this.repoPath()}/git/trees`, {
      base_tree: baseTree,
      tree: entries.map((e) => ({ path: e.path, mode: '100644', type: 'blob', sha: e.sha })),
    });
    return r.sha;
  }

  async createCommit(message: string, tree: string, parent: string): Promise<string> {
    const r = await this.request<{ sha: string }>('POST', `${this.repoPath()}/git/commits`, {
      message,
      tree,
      parents: [parent],
    });
    return r.sha;
  }

  /** Fast-forward only (no force). A 422 means the ref moved: re-sync and retry. */
  async updateRef(sha: string): Promise<void> {
    await this.request('PATCH', `${this.repoPath()}/git/refs/heads/${enc(this.ref.branch)}`, {
      sha,
      force: false,
    });
  }
}

export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Files the app reads: root CSVs, transaction month files and settings.json (not tools/ or .claude/). */
export function isDataPath(path: string): boolean {
  return (
    /^[^/]+\.csv$/.test(path) ||
    /^transactions\/\d{4}\/\d{4}-\d{2}\.csv$/.test(path) ||
    path === 'settings.json'
  );
}

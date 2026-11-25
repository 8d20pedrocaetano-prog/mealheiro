/** An in-memory GitHub (refs, commits, trees, blobs) speaking the REST endpoints the app uses. */
import { createHash } from 'node:crypto';
import { decodeBase64Utf8, encodeBase64Utf8 } from '../../src/sync/github';

interface Commit {
  tree: string;
  parent: string | null;
  message: string;
}

export class FakeGitHub {
  blobs = new Map<string, string>();
  trees = new Map<string, Map<string, string>>();
  commits = new Map<string, Commit>();
  head = '';
  isPrivate = true;
  /** Called once right before the next PATCH ref, to simulate a concurrent push. */
  beforeNextRefUpdate: (() => void) | null = null;
  requests: string[] = [];

  constructor(files: Record<string, string>) {
    this.head = this.commitFiles(files, null, 'initial');
  }

  private sha(s: string) {
    return createHash('sha1').update(s).digest('hex');
  }

  putBlob(text: string) {
    const sha = this.sha('blob:' + text);
    this.blobs.set(sha, text);
    return sha;
  }

  putTree(entries: Map<string, string>) {
    const sha = this.sha('tree:' + JSON.stringify([...entries].sort()));
    this.trees.set(sha, entries);
    return sha;
  }

  putCommit(c: Commit) {
    const sha = this.sha('commit:' + JSON.stringify(c) + Math.random());
    this.commits.set(sha, c);
    return sha;
  }

  commitFiles(files: Record<string, string>, parent: string | null, message: string) {
    const base = parent
      ? new Map(this.trees.get(this.commits.get(parent)!.tree)!)
      : new Map<string, string>();
    for (const [p, t] of Object.entries(files)) base.set(p, this.putBlob(t));
    return this.putCommit({ tree: this.putTree(base), parent, message });
  }

  /** Simulates an ingest session pushing a commit. */
  push(files: Record<string, string>, message = 'ingest') {
    this.head = this.commitFiles(files, this.head, message);
  }

  file(path: string, commit = this.head): string | undefined {
    const tree = this.trees.get(this.commits.get(commit)!.tree)!;
    const sha = tree.get(path);
    return sha ? this.blobs.get(sha) : undefined;
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
    this.requests.push(`${method} ${path}`);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    let m: RegExpMatchArray | null;
    if (method === 'GET' && path === '')
      return json(200, { full_name: 'o/r', private: this.isPrivate, permissions: { push: true } });
    if (method === 'GET' && /^\/git\/ref\/heads\//.test(path))
      return json(200, { object: { sha: this.head } });
    if (method === 'GET' && (m = path.match(/^\/git\/commits\/(\w+)$/))) {
      const c = this.commits.get(m[1]);
      return c ? json(200, { tree: { sha: c.tree } }) : json(404, {});
    }
    if (method === 'GET' && (m = path.match(/^\/git\/trees\/(\w+)$/))) {
      const treeSha = this.commits.get(m[1])?.tree ?? m[1];
      const t = this.trees.get(treeSha);
      if (!t) return json(404, {});
      return json(200, {
        truncated: false,
        tree: [...t].map(([p, sha]) => ({ path: p, mode: '100644', type: 'blob', sha })),
      });
    }
    if (method === 'GET' && (m = path.match(/^\/git\/blobs\/(\w+)$/))) {
      const text = this.blobs.get(m[1]);
      return text === undefined
        ? json(404, {})
        : json(200, { content: encodeBase64Utf8(text), encoding: 'base64' });
    }
    if (method === 'POST' && path === '/git/blobs')
      return json(201, { sha: this.putBlob(decodeBase64Utf8(body.content)) });
    if (method === 'POST' && path === '/git/trees') {
      const base = new Map(this.trees.get(body.base_tree)!);
      for (const e of body.tree) base.set(e.path, e.sha);
      return json(201, { sha: this.putTree(base) });
    }
    if (method === 'POST' && path === '/git/commits') {
      return json(201, {
        sha: this.putCommit({ tree: body.tree, parent: body.parents[0], message: body.message }),
      });
    }
    if (method === 'PATCH' && /^\/git\/refs\/heads\//.test(path)) {
      if (this.beforeNextRefUpdate) {
        const f = this.beforeNextRefUpdate;
        this.beforeNextRefUpdate = null;
        f();
      }
      const c = this.commits.get(body.sha)!;
      if (c.parent !== this.head) return json(422, { message: 'Update is not a fast forward' });
      this.head = body.sha;
      return json(200, { object: { sha: body.sha } });
    }
    return json(404, { message: `unhandled ${method} ${path}` });
  };
}

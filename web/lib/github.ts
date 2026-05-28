import { Octokit } from "octokit";
import { env } from "@/lib/env";
import {
  buildBlocklistEntry,
  upsertBlocklistEntry,
  type BlocklistEntry,
  type ReviewInput,
} from "@/lib/blocklist";

const KEYWORDS_PATH = "blocklist/spam-keywords.txt";

type FileState = { list: BlocklistEntry[]; sha: string };

async function readBlocklist(octokit: Octokit): Promise<FileState> {
  const res = await octokit.rest.repos.getContent({
    owner: env.GITHUB_REPO_OWNER,
    repo: env.GITHUB_REPO_NAME,
    path: env.GITHUB_BLOCKLIST_PATH,
    ref: env.GITHUB_BRANCH,
  });
  if (Array.isArray(res.data) || res.data.type !== "file") {
    throw new Error("blocklist path is not a file");
  }
  const content = Buffer.from(res.data.content, "base64").toString("utf-8");
  const list = JSON.parse(content) as BlocklistEntry[];
  return { list, sha: res.data.sha };
}

// Returns "added" if a new entry was committed, "exists" if user_id was already present.
export async function commitApprovedEntry(
  accessToken: string,
  review: ReviewInput,
): Promise<"added" | "exists"> {
  const octokit = new Octokit({ auth: accessToken });
  const { list, sha } = await readBlocklist(octokit);

  const addedDate = new Date().toISOString().slice(0, 10);
  const entry = buildBlocklistEntry(review, addedDate);
  const { list: nextList, added } = upsertBlocklistEntry(list, entry);
  if (!added) return "exists";

  const nextContent = JSON.stringify(nextList, null, 2) + "\n";
  await octokit.rest.repos.createOrUpdateFileContents({
    owner: env.GITHUB_REPO_OWNER,
    repo: env.GITHUB_REPO_NAME,
    path: env.GITHUB_BLOCKLIST_PATH,
    branch: env.GITHUB_BRANCH,
    message: `blocklist: add ${review.screen_name || review.user_id}`,
    content: Buffer.from(nextContent, "utf-8").toString("base64"),
    sha,
  });
  return "added";
}

export async function countBlocklistEntries(accessToken: string): Promise<number> {
  const octokit = new Octokit({ auth: accessToken });
  const { list } = await readBlocklist(octokit);
  return list.length;
}

// Read the raw spam-keywords.txt content (preserving comments/grouping).
export async function readKeywords(accessToken: string): Promise<string> {
  const octokit = new Octokit({ auth: accessToken });
  const res = await octokit.rest.repos.getContent({
    owner: env.GITHUB_REPO_OWNER,
    repo: env.GITHUB_REPO_NAME,
    path: KEYWORDS_PATH,
    ref: env.GITHUB_BRANCH,
  });
  if (Array.isArray(res.data) || res.data.type !== "file") {
    throw new Error("keywords path is not a file");
  }
  return Buffer.from(res.data.content, "base64").toString("utf-8");
}

// Commit new spam-keywords.txt content as the maintainer.
export async function saveKeywords(accessToken: string, content: string): Promise<void> {
  const octokit = new Octokit({ auth: accessToken });
  const current = await octokit.rest.repos.getContent({
    owner: env.GITHUB_REPO_OWNER,
    repo: env.GITHUB_REPO_NAME,
    path: KEYWORDS_PATH,
    ref: env.GITHUB_BRANCH,
  });
  if (Array.isArray(current.data) || current.data.type !== "file") {
    throw new Error("keywords path is not a file");
  }
  await octokit.rest.repos.createOrUpdateFileContents({
    owner: env.GITHUB_REPO_OWNER,
    repo: env.GITHUB_REPO_NAME,
    path: KEYWORDS_PATH,
    branch: env.GITHUB_BRANCH,
    message: "keywords: update spam-keywords.txt via admin",
    content: Buffer.from(content, "utf-8").toString("base64"),
    sha: current.data.sha,
  });
}

// Append MANY approved entries with a SINGLE read + single commit (dedup against
// the existing file and within the batch). Returns how many new entries were added.
export async function commitApprovedEntries(
  accessToken: string,
  reviews: ReviewInput[],
): Promise<{ added: number }> {
  if (reviews.length === 0) return { added: 0 };
  const octokit = new Octokit({ auth: accessToken });
  const { list, sha } = await readBlocklist(octokit);

  const addedDate = new Date().toISOString().slice(0, 10);
  let working = list;
  let added = 0;
  for (const review of reviews) {
    const entry = buildBlocklistEntry(review, addedDate);
    const res = upsertBlocklistEntry(working, entry);
    working = res.list;
    if (res.added) added++;
  }

  if (added === 0) return { added: 0 };

  const nextContent = JSON.stringify(working, null, 2) + "\n";
  await octokit.rest.repos.createOrUpdateFileContents({
    owner: env.GITHUB_REPO_OWNER,
    repo: env.GITHUB_REPO_NAME,
    path: env.GITHUB_BLOCKLIST_PATH,
    branch: env.GITHUB_BRANCH,
    message: `blocklist: add ${added} account(s)`,
    content: Buffer.from(nextContent, "utf-8").toString("base64"),
    sha,
  });
  return { added };
}

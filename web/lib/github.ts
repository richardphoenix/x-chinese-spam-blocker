import { Octokit } from "octokit";
import { env } from "@/lib/env";
import {
  buildBlocklistEntry,
  upsertBlocklistEntry,
  type BlocklistEntry,
  type ReviewInput,
} from "@/lib/blocklist";

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

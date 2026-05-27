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

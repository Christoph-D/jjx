import * as vscode from "vscode";
import path from "path";
import { toJJUri } from "./uri";
import type { JJRepository } from "./repository";
import { parseTreeInfo } from "./conflictParser";
import type { TreeInfo } from "./conflictParser";

export type { TreeInfo } from "./conflictParser";

interface ConflictData {
  leftFileId: string | null;
  baseFileId: string | null;
  rightFileId: string | null;
  leftLabel: string;
  baseLabel: string;
  rightLabel: string;
}

export async function openMergeEditor(
  repo: JJRepository,
  absoluteFilePath: string,
): Promise<void> {
  const relativePath = path.relative(repo.repositoryRoot, absoluteFilePath);
  const conflictData = await getConflictData(repo, relativePath);

  const fileUri = vscode.Uri.file(absoluteFilePath);

  const baseUri = toMergeUri(fileUri, conflictData.baseFileId);
  const leftUri = toMergeUri(fileUri, conflictData.leftFileId);
  const rightUri = toMergeUri(fileUri, conflictData.rightFileId);

  await vscode.commands.executeCommand("_open.mergeEditor", {
    base: baseUri,
    input1: {
      uri: leftUri,
      title: "Current",
      detail: conflictData.leftLabel,
    },
    input2: {
      uri: rightUri,
      title: "Incoming",
      detail: conflictData.rightLabel,
    },
    output: fileUri,
  });
}

function toMergeUri(fileUri: vscode.Uri, fileId: string | null): vscode.Uri {
  if (fileId === null) {
    return toJJUri(fileUri, { deleted: true });
  }
  return toJJUri(fileUri, { fileId });
}

async function getConflictData(
  repo: JJRepository,
  relativePath: string,
): Promise<ConflictData> {
  const treeInfo = await getTreeInfo(repo);

  const [leftFileId, baseFileId, rightFileId] = await Promise.all([
    getFileId(repo, treeInfo.treeIds[0], relativePath),
    getFileId(repo, treeInfo.treeIds[1], relativePath),
    getFileId(repo, treeInfo.treeIds[2], relativePath),
  ]);

  return {
    leftFileId,
    baseFileId,
    rightFileId,
    leftLabel: treeInfo.labels[0],
    baseLabel: treeInfo.labels[1],
    rightLabel: treeInfo.labels[2],
  };
}

async function getTreeInfo(repo: JJRepository): Promise<TreeInfo> {
  const commitId = await getCommitId(repo);
  const commitInfo = await getCommitDebugInfo(repo, commitId);
  return parseTreeInfo(commitInfo);
}

async function getCommitId(repo: JJRepository): Promise<string> {
  const output = await repo.showTemplate("@", "commit_id");
  return output.trim();
}

async function getCommitDebugInfo(
  repo: JJRepository,
  commitId: string,
): Promise<string> {
  const output = await repo.debugObject("commit", commitId);
  return output;
}

async function getFileId(
  repo: JJRepository,
  treeId: string,
  relativePath: string,
): Promise<string | null> {
  const output = await repo.debugTree(treeId, relativePath);
  const match = output.match(/FileId\("([^"]+)"\)/);
  return match ? match[1] : null;
}

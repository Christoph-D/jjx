import { Uri } from "vscode";
import { type } from "arktype";

const RevUriParams = type({ rev: "string" });
const DiffOriginalRevUriParams = type({
  diffOriginalRev: "string",
});
const FileIdUriParams = type({ fileId: "string" });
const DeletedUriParams = type({ deleted: "boolean" });
const JJUriParams = RevUriParams.or(DiffOriginalRevUriParams).or(FileIdUriParams).or(DeletedUriParams);

export type JJUriParams = typeof JJUriParams.infer;

/**
 * Use this for any URI that will go to JJFileSystemProvider.
 */
export function toJJUri(uri: Uri, params: JJUriParams): Uri {
  return uri.with({
    scheme: "jj",
    query: JSON.stringify(params),
  });
}

export function getParams(uri: Uri) {
  if (uri.query === "") {
    throw new Error("URI has no query");
  }
  const parsed = JJUriParams(JSON.parse(uri.query));
  if (parsed instanceof type.errors) {
    throw new Error("URI query is not JJUriParams");
  }
  return parsed;
}

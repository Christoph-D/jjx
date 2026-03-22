import { test, expect } from "./baseTest";

test("jj graph view loads and contains root commit", async ({ graphFrame }) => {
  const rootCommit = graphFrame.getByText("root()");
  await expect(rootCommit).toBeVisible({ timeout: 10000 });
});

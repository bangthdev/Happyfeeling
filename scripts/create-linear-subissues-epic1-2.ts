import "dotenv/config";

const LINEAR_API_URL = "https://api.linear.app/graphql";
const TEAM_NAME = "Happyfeeling";
const PLAN_PATH =
  "docs/superpowers/plans/2026-07-13-epic-1-2-monorepo-db-scaffold.md";
const LABEL_NAMES = ["sub-issue", "ai-code-review-bot"];

const API_KEY = process.env.LINEAR_API_KEY;
if (!API_KEY) {
  throw new Error(
    "Missing LINEAR_API_KEY in .env — tạo Personal API Key ở Linear Settings > API rồi thêm vào .env",
  );
}

interface SubIssueDef {
  key: string; // định danh nội bộ để nối quan hệ blocks, không phải hiển thị
  title: string;
  parentEpicTitle: string; // title đúng của epic cha, đã đổi số theo spec 2026-07-13
  description: string;
  priority: number;
  dependsOn: string[]; // key của sub-issue khác
}

const SUB_ISSUES: SubIssueDef[] = [
  {
    key: "task1",
    title: "nhd98z2/AIC-17-epic1-pnpm-workspace-skeleton",
    parentEpicTitle: "Epic 1: Monorepo Scaffold",
    description:
      "Tạo `pnpm-workspace.yaml` và package `packages/config` (tsconfig base dùng chung cho các package sau này) — chưa đụng gì đang chạy (root package.json, src/ giữ nguyên).\n\nHoàn thành khi: `pnpm install` chạy được và `pnpm -r list --depth -1` thấy `@happyfeeling/config` trong workspace.\n\nChi tiết: `" +
      PLAN_PATH +
      '` (mục "Task 1").',
    priority: 1,
    dependsOn: [],
  },
  {
    key: "a1",
    title: "nhd98z2/AIC-18-epic1-cutover-src-to-packages-github",
    parentEpicTitle: "Epic 1: Monorepo Scaffold",
    description:
      "Chuyển root sang pnpm (xoá package-lock.json, viết lại package.json root) và di chuyển `src/` hiện tại vào `packages/github` — giữ nguyên logic, chỉ thêm package.json/tsconfig riêng cho package.\n\nHoàn thành khi: `pnpm --filter @happyfeeling/github test` báo đủ 13 file / 38 test pass — đúng số lượng như trước khi chuyển.\n\nChi tiết: `" +
      PLAN_PATH +
      '` (mục "Task A1").',
    priority: 1,
    dependsOn: ["task1"],
  },
  {
    key: "a2",
    title: "nhd98z2/AIC-19-epic1-apps-web-empty-shell",
    parentEpicTitle: "Epic 1: Monorepo Scaffold",
    description:
      "Dựng 1 app Next.js rỗng tại `apps/web` — chưa có logic thật, Epic 3 mới thêm route webhook/dashboard.\n\nHoàn thành khi: `pnpm --filter @happyfeeling/web build` build thành công.\n\nChi tiết: `" +
      PLAN_PATH +
      '` (mục "Task A2").',
    priority: 2,
    dependsOn: ["task1"],
  },
  {
    key: "a3",
    title: "nhd98z2/AIC-20-epic1-docker-compose",
    parentEpicTitle: "Epic 1: Monorepo Scaffold",
    description:
      "Viết `apps/web/Dockerfile` + `docker-compose.yml` (service postgres, redis, web — chưa thêm worker vì chưa có code worker tới Epic 3).\n\nHoàn thành khi: `docker compose up -d postgres redis` cả 2 lên `Up`, và `docker compose build web` build được.\n\nChi tiết: `" +
      PLAN_PATH +
      '` (mục "Task A3").',
    priority: 2,
    dependsOn: ["a1", "a2"],
  },
  {
    key: "b1",
    title: "nhd98z2/AIC-21-epic2-prisma-schema-scaffold",
    parentEpicTitle: "Epic 2: Database & Schema",
    description:
      "Scaffold package `packages/db` + viết Prisma schema cho 4 model: Finding, Metric, Config, Ticket.\n\nHoàn thành khi: `pnpm --filter @happyfeeling/db exec prisma validate` báo schema hợp lệ.\n\nChi tiết: `" +
      PLAN_PATH +
      '` (mục "Task B1").',
    priority: 1,
    dependsOn: ["task1"],
  },
  {
    key: "b2",
    title: "nhd98z2/AIC-22-epic2-migrate-local-postgres",
    parentEpicTitle: "Epic 2: Database & Schema",
    description:
      "Chạy 1 Postgres tạm ở local (`docker run`, độc lập với Compose của Track A) rồi tạo migration Prisma đầu tiên từ schema.\n\nHoàn thành khi: migration áp dụng thành công và 4 bảng (Finding/Metric/Config/Ticket) xuất hiện trong DB.\n\nChi tiết: `" +
      PLAN_PATH +
      '` (mục "Task B2").',
    priority: 1,
    dependsOn: ["b1"],
  },
  {
    key: "b3",
    title: "nhd98z2/AIC-23-epic2-seed-script",
    parentEpicTitle: "Epic 2: Database & Schema",
    description:
      "Viết `client.ts` (PrismaClient singleton), `seed.ts` (seed dữ liệu mẫu) và 1 test xác nhận seed đúng.\n\nHoàn thành khi: test fail trước khi seed, và pass sau khi chạy seed.\n\nChi tiết: `" +
      PLAN_PATH +
      '` (mục "Task B3").',
    priority: 2,
    dependsOn: ["b2"],
  },
  {
    key: "task5",
    title: "nhd98z2/AIC-24-epic1-2-integration-check",
    parentEpicTitle: "Epic 2: Database & Schema",
    description:
      "Xác nhận Epic 1 (Docker) và Epic 2 (Prisma) chạy đúng cùng nhau — trỏ `packages/db` sang Postgres thật trong `docker-compose.yml` thay vì Postgres tạm, migrate + seed + test lại. Làm cuối cùng, sau khi cả Task A3 và B3 đã merge.\n\nHoàn thành khi: `pnpm -r test` toàn workspace pass hết (github 38, db 1) trên Postgres của Compose.\n\nChi tiết: `" +
      PLAN_PATH +
      '` (mục "Task 5").',
    priority: 2,
    dependsOn: ["a3", "b3"],
  },
];

async function linearRequest<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: API_KEY as string,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(`Linear API error: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

async function findTeamId(): Promise<string> {
  const data = await linearRequest<{
    teams: { nodes: { id: string; name: string; key: string }[] };
  }>(
    `query { teams(filter: { name: { eq: "${TEAM_NAME}" } }) { nodes { id name key } } }`,
  );
  if (data.teams.nodes.length !== 1) {
    throw new Error(`Không tìm thấy đúng 1 team tên "${TEAM_NAME}".`);
  }
  return data.teams.nodes[0].id;
}

async function findOrCreateLabelIds(teamId: string): Promise<string[]> {
  const data = await linearRequest<{
    issueLabels: { nodes: { id: string; name: string }[] };
  }>(
    `query($teamId: ID!) { issueLabels(filter: { team: { id: { eq: $teamId } } }) { nodes { id name } } }`,
    { teamId },
  );
  const existing = new Map(data.issueLabels.nodes.map((l) => [l.name, l.id]));
  const labelIds: string[] = [];
  for (const name of LABEL_NAMES) {
    const existingId = existing.get(name);
    if (existingId) {
      labelIds.push(existingId);
      continue;
    }
    const created = await linearRequest<{
      issueLabelCreate: { issueLabel: { id: string } };
    }>(
      `mutation($teamId: String!, $name: String!) {
        issueLabelCreate(input: { teamId: $teamId, name: $name }) { success issueLabel { id } }
      }`,
      { teamId, name },
    );
    console.log(`Đã tạo label mới: ${name}`);
    labelIds.push(created.issueLabelCreate.issueLabel.id);
  }
  return labelIds;
}

async function findIssueIdByTitle(
  teamId: string,
  title: string,
): Promise<string | null> {
  const data = await linearRequest<{
    issues: { nodes: { id: string; identifier: string }[] };
  }>(
    `query($teamId: ID!, $title: String!) {
      issues(filter: { team: { id: { eq: $teamId } }, title: { eq: $title } }) { nodes { id identifier } }
    }`,
    { teamId, title },
  );
  return data.issues.nodes[0]?.id ?? null;
}

async function upsertSubIssue(
  teamId: string,
  labelIds: string[],
  parentId: string,
  sub: SubIssueDef,
): Promise<{ id: string; identifier: string; url: string }> {
  const existingId = await findIssueIdByTitle(teamId, sub.title);
  if (existingId) {
    const data = await linearRequest<{
      issueUpdate: {
        success: boolean;
        issue: { id: string; identifier: string; url: string };
      };
    }>(
      `mutation($id: String!, $description: String!, $priority: Int!) {
        issueUpdate(id: $id, input: { description: $description, priority: $priority }) {
          success
          issue { id identifier url }
        }
      }`,
      { id: existingId, description: sub.description, priority: sub.priority },
    );
    console.log(`Đã cập nhật description: ${sub.title}`);
    return data.issueUpdate.issue;
  }

  const data = await linearRequest<{
    issueCreate: {
      success: boolean;
      issue: { id: string; identifier: string; url: string };
    };
  }>(
    `mutation($teamId: String!, $parentId: String!, $title: String!, $description: String!, $priority: Int!, $labelIds: [String!]!) {
      issueCreate(input: {
        teamId: $teamId,
        parentId: $parentId,
        title: $title,
        description: $description,
        priority: $priority,
        labelIds: $labelIds
      }) { success issue { id identifier url } }
    }`,
    {
      teamId,
      parentId,
      title: sub.title,
      description: sub.description,
      priority: sub.priority,
      labelIds,
    },
  );
  console.log(`Đã tạo: ${data.issueCreate.issue.identifier} — ${sub.title}`);
  return data.issueCreate.issue;
}

async function blockRelationExists(
  blockerId: string,
  blockedId: string,
): Promise<boolean> {
  const data = await linearRequest<{
    issue: {
      relations: { nodes: { type: string; relatedIssue: { id: string } }[] };
    };
  }>(
    `query($blockerId: String!) {
      issue(id: $blockerId) { relations { nodes { type relatedIssue { id } } } }
    }`,
    { blockerId },
  );
  return data.issue.relations.nodes.some(
    (r) => r.type === "blocks" && r.relatedIssue.id === blockedId,
  );
}

async function createBlockRelation(
  blockerId: string,
  blockedId: string,
): Promise<void> {
  if (await blockRelationExists(blockerId, blockedId)) {
    return;
  }
  await linearRequest(
    `mutation($issueId: String!, $relatedIssueId: String!) {
      issueRelationCreate(input: { issueId: $issueId, relatedIssueId: $relatedIssueId, type: blocks }) {
        success
      }
    }`,
    { issueId: blockerId, relatedIssueId: blockedId },
  );
}

async function main() {
  const teamId = await findTeamId();
  const labelIds = await findOrCreateLabelIds(teamId);

  const parentIds = new Map<string, string>();
  for (const epicTitle of [
    "Epic 1: Monorepo Scaffold",
    "Epic 2: Database & Schema",
  ]) {
    const id = await findIssueIdByTitle(teamId, epicTitle);
    if (!id) {
      throw new Error(
        `Không tìm thấy epic cha "${epicTitle}" trên Linear — kiểm tra lại đã tạo 12 epic chưa.`,
      );
    }
    parentIds.set(epicTitle, id);
  }

  const created = new Map<
    string,
    { id: string; identifier: string; url: string }
  >();
  for (const sub of SUB_ISSUES) {
    const parentId = parentIds.get(sub.parentEpicTitle)!;
    const issue = await upsertSubIssue(teamId, labelIds, parentId, sub);
    created.set(sub.key, issue);
  }

  for (const sub of SUB_ISSUES) {
    for (const depKey of sub.dependsOn) {
      const blocker = created.get(depKey)!;
      const blocked = created.get(sub.key)!;
      await createBlockRelation(blocker.id, blocked.id);
    }
  }
  console.log('Đã set xong quan hệ "blocks" giữa các sub-issue.');

  console.log("\n--- Danh sách sub-issue ---");
  for (const sub of SUB_ISSUES) {
    const issue = created.get(sub.key)!;
    console.log(`${issue.identifier}: ${sub.title} — ${issue.url}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

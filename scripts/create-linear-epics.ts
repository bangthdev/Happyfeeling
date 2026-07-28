import "dotenv/config";

const LINEAR_API_URL = "https://api.linear.app/graphql";
const TEAM_NAME = "Happyfeeling";
const LABEL_NAMES = ["epic", "ai-code-review-bot"];

const API_KEY = process.env.LINEAR_API_KEY;
if (!API_KEY) {
  throw new Error(
    "Missing LINEAR_API_KEY in .env — tạo Personal API Key ở Linear Settings > API rồi thêm vào .env",
  );
}

interface EpicDef {
  num: number;
  title: string;
  oldTitle: string; // title cũ (đánh số 0-11) — dùng để tìm và migrate issue đã tạo trước đây
  description: string;
  priority: number; // 1=Urgent 2=High 3=Medium 4=Low
  dependsOn: number[];
}

const EPICS: EpicDef[] = [
  {
    num: 1,
    title: "Epic 1: Monorepo Scaffold",
    oldTitle: "Epic 0: Monorepo Scaffold",
    description:
      "Chuyển từ flat repo sang pnpm workspace mà không làm hỏng bot cũ đang chạy. Port `src/` cũ vào `packages/github`, dựng `apps/web` rỗng, 38 test cũ chạy lại được trong cấu trúc mới. Deliverable bổ sung: Docker — Dockerfile cho apps/web/worker, docker-compose.yml cho local dev (Postgres, Redis, web, worker).\n\nDepends on: —",
    priority: 1,
    dependsOn: [],
  },
  {
    num: 2,
    title: "Epic 2: Database & Schema",
    oldTitle: "Epic 1: Database & Schema",
    description:
      "Có nơi lưu trạng thái bền vững (Finding, Metric, Config, Ticket) thay file log — schema Prisma, migration, seed.\n\nDepends on: Epic 1",
    priority: 1,
    dependsOn: [1],
  },
  {
    num: 3,
    title: "Epic 3: Walking Skeleton trên Next.js",
    oldTitle: "Epic 2: Walking Skeleton trên Next.js",
    description:
      "Chứng minh nền móng mới chạy được end-to-end và đúng kiến trúc async: webhook route trả 200 ngay lập tức, đẩy job vào hàng đợi BullMQ + Redis, worker riêng (Node process) mới chạy LLM 1 lượt đơn giản → post đúng vị trí bằng `line`+`side` → ghi DB.\n\nDepends on: Epic 1, Epic 2",
    priority: 1,
    dependsOn: [1, 2],
  },
  {
    num: 4,
    title: "Epic 4: Dedup & Idempotency",
    oldTitle: "Epic 3: Dedup & Idempotency",
    description:
      "Không post trùng finding khi review lại nhiều lần cùng PR — hash (file+dòng+loại lỗi) lưu DB. Chống lặp từ 2 nguồn: dev push nhiều lần, VÀ GitHub gửi lại (retry) cùng 1 webhook — retry có thể xảy ra vì nhiều lý do (lỗi mạng, redeliver thủ công từ GitHub UI...), không chỉ vì phản hồi chậm trước khi có queue.\n\nDepends on: Epic 2, Epic 3",
    priority: 2,
    dependsOn: [2, 3],
  },
  {
    num: 5,
    title: 'Epic 5: LangGraph — Node "Người tìm"',
    oldTitle: 'Epic 4: LangGraph — Node "Người tìm"',
    description:
      "Lượt 1: tìm rộng mọi vấn đề có thể, kể cả chưa chắc chắn — chưa quan tâm độ chính xác. Chỉ sinh finding, chưa post comment nên chưa cần dedup.\n\nDepends on: Epic 3",
    priority: 2,
    dependsOn: [3],
  },
  {
    num: 6,
    title: 'Epic 6: LangGraph — Node "Người lọc" + post comment',
    oldTitle: 'Epic 5: LangGraph — Node "Người lọc" + post comment',
    description:
      'Lượt 2: chạy song song từng finding, mặc định loại trừ trừ khi có lý do rõ ràng để giữ; finding sống sót mới được post. Bắt buộc tích hợp check dedup (Epic 4) trước khi post — không được coi là xong/merge nếu chưa có dedup. Deliverable bổ sung: giữ 1 tập PR+finding known-good nhỏ làm regression test, chạy lại mỗi khi sửa prompt lọc.\n\nLưu ý khi chia sub-issue: có thể tách task "build node filter" và "build dedup-check" thành 2 branch độc lập (an toàn vì chưa nối vào pipeline thật), nhưng task "wire filter vào pipeline thật để bắt đầu post comment" bắt buộc đứng sau (hoặc gộp cùng) task dedup-check đã lên main — không merge riêng trước.\n\nDepends on: Epic 4, Epic 5',
    priority: 2,
    dependsOn: [4, 5],
  },
  {
    num: 7,
    title: "Epic 7: Dashboard UI",
    oldTitle: "Epic 6: Dashboard UI",
    description:
      'Xem PR/finding + tỷ lệ resolved theo category (đọc từ Epic 10), biểu đồ theo thời gian qua tRPC. Deliverable bổ sung: auth đơn giản bảo vệ toàn bộ web app — password chung qua env var + middleware, hoặc Basic Auth ở tầng host. Đủ cho quy mô 2 người dùng biết nhau, không cần hệ thống login/role. Khác với "webhook verify" (Epic 1/3, xác thực request GitHub→bot, không bảo vệ người dùng vào xem UI).\n\nDepends on: Epic 2, Epic 6, Epic 10',
    priority: 3,
    dependsOn: [2, 6, 10],
  },
  {
    num: 8,
    title: "Epic 8: Config UI",
    oldTitle: "Epic 7: Config UI",
    description:
      "Sửa threshold lọc/prompt qua UI, pipeline đọc từ DB thay vì hardcode. Khi đổi prompt qua UI, chạy lại tập regression test ở Epic 6 trước khi apply. Dùng lại layer auth đã dựng ở Epic 7, không cần thêm.\n\nDepends on: Epic 2, Epic 6, Epic 7",
    priority: 3,
    dependsOn: [2, 6, 7],
  },
  {
    num: 9,
    title: "Epic 9: Linear Integration",
    oldTitle: "Epic 8: Linear Integration",
    description:
      "Regex ticket ID, GraphQL API, đưa `title`+`description` vào cả 2 lượt LLM (người tìm lẫn người lọc).\n\nDepends on: Epic 5, Epic 6",
    priority: 3,
    dependsOn: [5, 6],
  },
  {
    num: 10,
    title: "Epic 10: Resolved-rate Metrics (tự động)",
    oldTitle: "Epic 9: Resolved-rate Metrics (tự động)",
    description:
      "Suy luận resolved/ignored từ bảng dedup (Epic 4), tính tỷ lệ theo category — con số khách quan thay cảm tính. Cần dữ liệu finding thật (chỉ có sau khi Epic 6 chạy và post comment thật) mới tính được số có nghĩa — schema Epic 4 không đủ.\n\nDepends on: Epic 4, Epic 6",
    priority: 3,
    dependsOn: [4, 6],
  },
  {
    num: 11,
    title: "Epic 11: Manual Review & Baseline (quy trình định kỳ)",
    oldTitle: "Epic 10: Manual Review & Baseline (quy trình định kỳ)",
    description:
      "Đọc tay PR ở category thấp nhất mỗi tuần + cấy seeded-bug + đối chiếu Claude Code Review — bù sai số mà Epic 10 không thấy được.\n\nDepends on: Epic 10",
    priority: 4,
    dependsOn: [10],
  },
  {
    num: 12,
    title: "Epic 12: Slack Integration",
    oldTitle: "Epic 11: Slack Integration",
    description:
      "Cơ chế `@HappyFeeling` mention-in-thread — ưu tiên thấp nhất.\n\nDepends on: Epic 9",
    priority: 4,
    dependsOn: [9],
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
    throw new Error(
      `Không tìm thấy đúng 1 team tên "${TEAM_NAME}" (tìm thấy ${data.teams.nodes.length}). Kiểm tra lại tên team trên Linear.`,
    );
  }
  const team = data.teams.nodes[0];
  console.log(`Team: ${team.name} (key: ${team.key}, id: ${team.id})`);
  return team.id;
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
      issueLabelCreate: { success: boolean; issueLabel: { id: string } };
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

async function getIssueById(
  id: string,
): Promise<{ id: string; identifier: string; url: string }> {
  const data = await linearRequest<{
    issue: { id: string; identifier: string; url: string };
  }>(`query($id: String!) { issue(id: $id) { id identifier url } }`, { id });
  return data.issue;
}

async function updateIssue(
  id: string,
  labelIds: string[],
  epic: EpicDef,
): Promise<{ id: string; identifier: string; url: string }> {
  const data = await linearRequest<{
    issueUpdate: {
      success: boolean;
      issue: { id: string; identifier: string; url: string };
    };
  }>(
    `mutation($id: String!, $title: String!, $description: String!, $priority: Int!, $labelIds: [String!]!) {
      issueUpdate(id: $id, input: {
        title: $title,
        description: $description,
        priority: $priority,
        labelIds: $labelIds
      }) { success issue { id identifier url } }
    }`,
    {
      id,
      title: epic.title,
      description: epic.description,
      priority: epic.priority,
      labelIds,
    },
  );
  console.log(
    `Đã đổi số: ${data.issueUpdate.issue.identifier} — "${epic.oldTitle}" → "${epic.title}"`,
  );
  return data.issueUpdate.issue;
}

async function createIssue(
  teamId: string,
  labelIds: string[],
  epic: EpicDef,
): Promise<{ id: string; identifier: string; url: string }> {
  const data = await linearRequest<{
    issueCreate: {
      success: boolean;
      issue: { id: string; identifier: string; url: string };
    };
  }>(
    `mutation($teamId: String!, $title: String!, $description: String!, $priority: Int!, $labelIds: [String!]!) {
      issueCreate(input: {
        teamId: $teamId,
        title: $title,
        description: $description,
        priority: $priority,
        labelIds: $labelIds
      }) { success issue { id identifier url } }
    }`,
    {
      teamId,
      title: epic.title,
      description: epic.description,
      priority: epic.priority,
      labelIds,
    },
  );
  console.log(`Đã tạo: ${data.issueCreate.issue.identifier} — ${epic.title}`);
  return data.issueCreate.issue;
}

async function upsertIssue(
  teamId: string,
  labelIds: string[],
  epic: EpicDef,
): Promise<{ id: string; identifier: string; url: string }> {
  const alreadyMigratedId = await findIssueIdByTitle(teamId, epic.title);
  if (alreadyMigratedId) {
    console.log(`Bỏ qua (đã đúng số mới): ${epic.title}`);
    return getIssueById(alreadyMigratedId);
  }

  const oldId = await findIssueIdByTitle(teamId, epic.oldTitle);
  if (oldId) {
    return updateIssue(oldId, labelIds, epic);
  }

  return createIssue(teamId, labelIds, epic);
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

  const created = new Map<
    number,
    { id: string; identifier: string; url: string }
  >();
  for (const epic of EPICS) {
    const issue = await upsertIssue(teamId, labelIds, epic);
    created.set(epic.num, issue);
  }

  for (const epic of EPICS) {
    for (const depNum of epic.dependsOn) {
      const blocker = created.get(depNum)!;
      const blocked = created.get(epic.num)!;
      await createBlockRelation(blocker.id, blocked.id);
    }
  }
  console.log(
    'Đã set xong quan hệ "blocks" giữa các epic theo bảng phụ thuộc.',
  );

  console.log("\n--- Danh sách issue ---");
  for (const epic of EPICS) {
    const issue = created.get(epic.num)!;
    console.log(`${issue.identifier}: ${epic.title} — ${issue.url}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

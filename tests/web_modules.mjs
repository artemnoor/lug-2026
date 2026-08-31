import assert from "node:assert/strict";
import { createRatingRows } from "../apps/web/public/js/modules/rating.js";
import { parseVideoUrl } from "../apps/web/public/js/modules/video.js";
import {
  phaseState,
  teamMatches,
  workflow,
} from "../apps/web/public/js/modules/admin-workflow.js";
import {
  nameInitial,
  plural,
} from "../apps/web/public/js/modules/cabinet-utils.js";
import { adminApi } from "../apps/web/public/js/modules/admin-api.js";
import {
  achievementStatusChip,
  renderAchievementRow,
  renderRating,
  renderTeamRow,
  renderUserRow,
} from "../apps/web/public/js/modules/admin-renderers.js";
import { renderAchievementDetail } from "../apps/web/public/js/modules/admin-detail-renderers.js";
import { renderNotifications } from "../apps/web/public/js/modules/cabinet-renderers.js";
import {
  isAllowedFile,
  isStrongPassword,
  messengerMeta,
} from "../apps/web/public/js/modules/site-auth-helpers.js";

const rows = createRatingRows([
  {
    id: "team-a",
    name: "Альфа",
    isAdmitted: true,
    achievements: [{ status: "approved", points: 20, direction: "science" }],
    videoCard: { status: "approved", score: 10 },
  },
  {
    id: "team-b",
    name: "Бета",
    isAdmitted: false,
    achievements: [{ status: "approved", points: 40, direction: "sport" }],
  },
]);
assert.deepEqual(
  rows.map((row) => row.team.id),
  ["team-b", "team-a"],
);
assert.equal(rows[0].total, 40);
assert.equal(rows[1].videoPoints, 10);
assert.equal(
  parseVideoUrl("https://rutube.ru/video/abc_123").embedUrl,
  "https://rutube.ru/play/embed/abc_123",
);
assert.equal(parseVideoUrl("https://example.com/video").valid, false);
assert.equal(isStrongPassword("Strong!Test1"), true);
assert.equal(isStrongPassword("weak"), false);
assert.equal(messengerMeta.telegram.test("@valid_user"), true);
assert.equal(isAllowedFile({ type: "image/png", name: "card.png" }), true);
assert.equal(
  isAllowedFile({ type: "application/x-msdownload", name: "card.exe" }),
  false,
);
assert.equal(workflow({}).key, "new");
assert.equal(
  teamMatches({ name: "Alpha", group: "A-01", members: [] }, "alpha"),
  true,
);
assert.equal(phaseState({ start: "nope" }, "start", "end"), "none");
assert.equal(nameInitial(""), "У");
assert.equal(plural(22, "день", "дня", "дней"), "дня");
globalThis.window = {
  lugStore: { adminOverview: () => Promise.resolve({ ok: true }) },
};
assert.deepEqual(await adminApi.adminOverview(), { ok: true });
const esc = (value) => String(value ?? "");
const pendingForTeam = () => ({ total: 1 });
const workflowPresentation = () => ({
  className: "is-review",
  label: "На проверке",
});
const workflowMeta = {};
assert.match(
  renderTeamRow({
    team: {
      id: "team-a",
      name: "Альфа",
      group: "A-01",
      members: [],
      captain: { fio: "Капитан" },
    },
    index: 0,
    selectedTeamId: "team-a",
    esc,
    plural: (count) => (count === 1 ? "участник" : "участников"),
    pendingForTeam,
    workflowPresentation,
    workflowMeta,
  }),
  /Альфа/,
);
assert.match(
  renderUserRow({
    user: { id: "user-a", fio: "Иванов Иван", teamId: "team-a" },
    state: { teams: [] },
    selectedUserId: "",
    esc,
    initials: () => "ИИ",
  }),
  /Иванов Иван/,
);
assert.match(
  renderAchievementRow({
    achievement: {
      id: "achievement-a",
      title: "Победа",
      direction: "science",
      user: { fio: "Иванов" },
    },
    team: null,
    selectedAchievementId: "",
    esc,
    directionIcons: { science: "★" },
    directionLabels: { science: "Наука" },
  }),
  /Победа/,
);
assert.match(achievementStatusChip("approved"), /Принято/);
const ratingNodes = new Map([
  ["adminRatingBoard", { innerHTML: "" }],
  ["adminRatingTeamsCount", { textContent: "" }],
]);
renderRating({
  state: { teams: [] },
  $: (id) => ratingNodes.get(id),
  esc,
  createRatingRows,
  workflowPresentation,
  workflowMeta,
  directionLabels: { science: "Наука" },
  plural: (count) => (count === 1 ? "участник" : "участников"),
});
assert.match(
  ratingNodes.get("adminRatingBoard").innerHTML,
  /Рейтинг пока пуст/,
);
assert.match(
  renderAchievementDetail({
    achievement: {
      id: "achievement-a",
      title: "Победа",
      direction: "science",
      status: "pending",
      user: { id: "user-a", fio: "Иванов" },
    },
    team: null,
    esc,
    directionLabels: { science: "Наука" },
    achievementStatusChip,
    shortDateLabel: () => "сегодня",
    dateLabel: () => "сегодня",
  }),
  /Победа/,
);
const notificationRoot = new Map();
const notification$ = (id) => {
  if (!notificationRoot.has(id))
    notificationRoot.set(id, { hidden: false, textContent: "", innerHTML: "" });
  return notificationRoot.get(id);
};
const notification$$ = () => [];
renderNotifications({
  items: [],
  state: { user: { id: "user-a" } },
  $: notification$,
  $$: notification$$,
  esc,
  date: () => "сегодня",
  readNotification: async () => {},
  refresh: async () => {},
});
assert.match(
  notificationRoot.get("#notificationList").innerHTML,
  /Пока нет сообщений/,
);
console.log("web-modules: ok");

/** Admin transport boundary. UI code depends on this small surface, not on the global store. */
const store = () => window.lugStore;

export const adminApi = {
  adminBroadcast: (...args) => store().adminBroadcast(...args),
  adminCollection: (...args) => store().adminCollection(...args),
  adminOverview: (...args) => store().adminOverview(...args),
  adminRemoveMember: (...args) => store().adminRemoveMember(...args),
  adminReviewAchievement: (...args) => store().adminReviewAchievement(...args),
  adminReviewIdentity: (...args) => store().adminReviewIdentity(...args),
  adminReviewTeamField: (...args) => store().adminReviewTeamField(...args),
  adminReviewVideo: (...args) => store().adminReviewVideo(...args),
  adminUpdateQuota: (...args) => store().adminUpdateQuota(...args),
  adminUpdateSettings: (...args) => store().adminUpdateSettings(...args),
  logout: (...args) => store().logout(...args),
  session: (...args) => store().session(...args)
};

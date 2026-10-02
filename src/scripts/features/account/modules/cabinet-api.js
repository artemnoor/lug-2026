/** Participant transport boundary shared by cabinet actions. */
const store = () => window.lugStore;

export const cabinetApi = {
  addAchievement: (...args) => store().addAchievement(...args),
  dashboard: (...args) => store().dashboard(...args),
  deleteAchievement: (...args) => store().deleteAchievement(...args),
  logout: (...args) => store().logout(...args),
  readNotification: (...args) => store().readNotification(...args),
  rotateInvite: (...args) => store().rotateInvite(...args),
  session: (...args) => store().session(...args),
  updateProfile: (...args) => store().updateProfile(...args),
  updateTeam: (...args) => store().updateTeam(...args),
  updateVideo: (...args) => store().updateVideo(...args),
  upload: (...args) => store().upload(...args)
};

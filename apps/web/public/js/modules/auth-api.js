/** Public authentication transport boundary. */
const store = () => window.lugStore;

export const authApi = {
  invite: (...args) => store().invite(...args),
  login: (...args) => store().login(...args),
  registerCaptain: (...args) => store().registerCaptain(...args),
  registerParticipant: (...args) => store().registerParticipant(...args),
  request: (...args) => store().request(...args),
  requestPasswordReset: (...args) => store().requestPasswordReset(...args),
  resendEmailCode: (...args) => store().resendEmailCode(...args),
  resetPassword: (...args) => store().resetPassword(...args),
  session: (...args) => store().session(...args),
  uploadRegistrationCard: (...args) => store().uploadRegistrationCard(...args),
  verifyEmail: (...args) => store().verifyEmail(...args)
};

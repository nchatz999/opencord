import type { Result } from "opencord-utils";
import { err, ok } from "opencord-utils";
import { userDomain } from "../store";

const saveSession = (token: string, id: number) => {
  document.cookie = `session_token=${token}; path=/; SameSite=Lax`;
  document.cookie = `user_id=${id}; path=/; SameSite=Lax`;
  userDomain.setCurrentUser(id)
};

interface AuthToken {
  userId: number,
  sessionToken: string
}
const loadSession = (): Result<AuthToken, Error> => {
  let userId;
  let sessionToken;
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === "session_token") {
      sessionToken = value
    }
    if (name === "user_id") {
      userId = parseInt(value)
    }
  }
  if (userId && sessionToken)
    return ok({ sessionToken, userId });
  return err(new Error('No session'))
};

const clearSession = () => {
  
  document.cookie = `session_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  document.cookie = `user_id=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
};

export {
  saveSession,
  loadSession,
  clearSession,
};

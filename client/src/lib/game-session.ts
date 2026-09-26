export type GameSession = {
  gameId: string;
  playerToken: string;
  playerId: string;
  joinCode: string;
  rejoinCode: string;
};

const SESSION_KEY = "outbreak24-session";

export function loadGameSession(): GameSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    if (!parsed?.gameId || !parsed?.playerToken || !parsed?.rejoinCode) return null;
    return parsed as GameSession;
  } catch {
    return null;
  }
}

export function saveGameSession(session: GameSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearGameSession() {
  localStorage.removeItem(SESSION_KEY);
}

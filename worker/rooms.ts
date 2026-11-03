import { generateCode, generateToken } from "./codes";
import type { Room } from "./room";

export const MAX_CREATE_ATTEMPTS = 10;

export function roomStub(env: Env, code: string) {
  return env.ROOM.get(env.ROOM.idFromName(code)) as unknown as DurableObjectStub<Room>;
}

/** Pick a free code (retrying on collision up to 10 times) and claim it for a fresh host token. */
export async function createRoom(
  env: Env,
  gen: () => string = generateCode,
): Promise<{ code: string; hostToken: string } | null> {
  const hostToken = generateToken();
  for (let i = 0; i < MAX_CREATE_ATTEMPTS; i++) {
    const code = gen();
    if (await roomStub(env, code).claim(hostToken, code)) return { code, hostToken };
  }
  return null;
}

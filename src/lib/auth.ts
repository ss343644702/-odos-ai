import { prisma } from './prisma';
import { getUser } from './supabase-server';

/** Get current authenticated user's DB record, creating if needed */
export async function getOrCreateDbUser() {
  const authUser = await getUser();
  if (!authUser) return null;

  let dbUser = await prisma.user.findUnique({
    where: { supabaseId: authUser.id },
  });

  if (!dbUser) {
    dbUser = await prisma.user.create({
      data: {
        supabaseId: authUser.id,
        email: authUser.email || null,
        nickname: authUser.user_metadata?.nickname || authUser.email?.split('@')[0] || '创作者',
        avatarUrl: authUser.user_metadata?.avatar_url || null,
      },
    });
  } else {
    // Sync profile fields from Supabase auth (avatar, nickname may change)
    const newAvatar = authUser.user_metadata?.avatar_url || null;
    const newNickname = authUser.user_metadata?.nickname || null;
    const updates: Record<string, string | null> = {};
    if (newAvatar && newAvatar !== dbUser.avatarUrl) updates.avatarUrl = newAvatar;
    if (newNickname && newNickname !== dbUser.nickname) updates.nickname = newNickname;
    if (Object.keys(updates).length > 0) {
      dbUser = await prisma.user.update({
        where: { id: dbUser.id },
        data: updates,
      });
    }
  }

  return dbUser;
}

/** Require auth — returns DB user or throws */
export async function requireUser() {
  const user = await getOrCreateDbUser();
  if (!user) throw new Error('Unauthorized');
  return user;
}

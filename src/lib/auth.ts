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
  }

  return dbUser;
}

/** Require auth — returns DB user or throws */
export async function requireUser() {
  const user = await getOrCreateDbUser();
  if (!user) throw new Error('Unauthorized');
  return user;
}

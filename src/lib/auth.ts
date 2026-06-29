import { prisma } from './prisma';
import { getUser } from './supabase-server';

/** Get current authenticated user's DB record, creating if needed */
export async function getOrCreateDbUser() {
  const authUser = await getUser();
  if (!authUser) return null;

  const email = authUser.email || null;
  const metaNickname = authUser.user_metadata?.nickname || null;
  const nickname = metaNickname || authUser.email?.split('@')[0] || '创作者';
  const avatarUrl = authUser.user_metadata?.avatar_url || null;

  try {
    // Atomic upsert keyed on supabaseId. The old find-then-create was a race: /api/sessions and
    // /api/me fire in parallel, both see "no user", both create → second fails P2002 on the unique
    // email/supabaseId. Upsert (INSERT … ON CONFLICT (supabaseId)) collapses that to one row.
    return await prisma.user.upsert({
      where: { supabaseId: authUser.id },
      create: { supabaseId: authUser.id, email, nickname, avatarUrl },
      update: {
        // keep avatar/nickname synced with Supabase, but never overwrite with null
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(metaNickname ? { nickname } : {}),
      },
    });
  } catch (e: any) {
    // Still P2002 — either a concurrent upsert won the insert race, or this email already belongs
    // to a DIFFERENT supabaseId. Recover instead of 500-ing.
    if (e?.code === 'P2002') {
      const existing = await prisma.user.findUnique({ where: { supabaseId: authUser.id } });
      if (existing) return existing; // concurrent request created it — use that
      // Email is owned by another account → create this user without the conflicting email.
      return prisma.user.create({ data: { supabaseId: authUser.id, email: null, nickname, avatarUrl } });
    }
    throw e;
  }
}

/** Require auth — returns DB user or throws */
export async function requireUser() {
  const user = await getOrCreateDbUser();
  if (!user) throw new Error('Unauthorized');
  return user;
}

// src/app/actions/notification-actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function markNotificationAsReadAction(notificationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Authentication required.');

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, updated_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', user.id);

  if (error) {
    throw new Error(`Failed to update notification: ${error.message}`);
  }

  revalidatePath('/instructor');
  revalidatePath('/instructor/notifications');
  return { success: true };
}

export async function markAllNotificationsAsReadAction() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Authentication required.');

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('is_read', false);

  if (error) {
    throw new Error(`Failed to mark all as read: ${error.message}`);
  }

  revalidatePath('/instructor');
  revalidatePath('/instructor/notifications');
  return { success: true };
}

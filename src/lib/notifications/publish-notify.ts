// src/lib/notifications/publish-notify.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmailNotification } from './email.ts';

export interface PublishNotificationResult {
  inAppCount: number;
  emailCount: number;
  recipientInstructorIds: string[];
}

/**
 * Creates in-app notifications and sends email notices to all instructors
 * who have teaching assignments in the newly published schedule version.
 */
export async function notifyInstructorsOnPublish(
  supabase: SupabaseClient,
  versionId: string,
  termName: string,
  versionNumber: number,
  isFirstVersionForTerm: boolean
): Promise<PublishNotificationResult> {
  // 1. Fetch distinct instructors who have entries in this version
  const { data: entries, error: entriesErr } = await supabase
    .from('schedule_entries')
    .select(`
      instructor_id,
      day_of_week,
      start_time,
      end_time,
      session_type,
      class_offerings (
        subjects (
          code,
          title
        ),
        blocks (
          year_level,
          section
        )
      ),
      rooms (
        name
      )
    `)
    .eq('version_id', versionId);

  if (entriesErr || !entries || entries.length === 0) {
    return { inAppCount: 0, emailCount: 0, recipientInstructorIds: [] };
  }

  // Group entries by instructor
  const entriesByInstructor = new Map<string, typeof entries>();
  for (const entry of entries) {
    if (!entry.instructor_id) continue;
    const list = entriesByInstructor.get(entry.instructor_id) || [];
    list.push(entry);
    entriesByInstructor.set(entry.instructor_id, list);
  }

  const instructorIds = Array.from(entriesByInstructor.keys());
  if (instructorIds.length === 0) {
    return { inAppCount: 0, emailCount: 0, recipientInstructorIds: [] };
  }

  // 2. Fetch instructor profile info (full_name, profile_id, and email via profiles)
  const { data: instructors, error: instErr } = await supabase
    .from('instructors')
    .select('id, full_name, profile_id, profiles(email)')
    .in('id', instructorIds);

  if (instErr || !instructors) {
    console.error('Failed to load instructor profiles for notifications:', instErr?.message);
    return { inAppCount: 0, emailCount: 0, recipientInstructorIds: [] };
  }

  let inAppCount = 0;
  let emailCount = 0;

  // 3. Dispatch for each instructor
  for (const inst of instructors) {
    const instEntries = entriesByInstructor.get(inst.id) || [];
    const totalSessions = instEntries.length;

    // Distinct subjects
    const subjectSet = new Set<string>();
    for (const e of instEntries) {
      const sub = (e.class_offerings as any)?.subjects;
      if (sub?.code) subjectSet.add(sub.code);
    }
    const subjectsList = Array.from(subjectSet).join(', ');

    const title = isFirstVersionForTerm
      ? `Your Schedule for ${termName} is Now Published`
      : `Schedule Updated: ${termName} (Version ${versionNumber})`;

    const summaryText = isFirstVersionForTerm
      ? `Your official teaching timetable for ${termName} (Version ${versionNumber}) has been published. You are assigned to ${totalSessions} weekly session(s) across: ${subjectsList || 'your courses'}.`
      : `An updated teaching schedule for ${termName} (Version ${versionNumber}) has been published. You have ${totalSessions} weekly session(s) across: ${subjectsList || 'your courses'}. Please review your schedule.`;

    // A. In-app notification
    if (inst.profile_id) {
      try {
        const { error: notifErr } = await supabase.from('notifications').insert({
          user_id: inst.profile_id,
          title,
          body: summaryText,
          is_read: false,
        });

        if (!notifErr) {
          inAppCount++;
        } else {
          console.error(`Failed to insert notification for instructor ${inst.id}:`, notifErr.message);
        }
      } catch (err: any) {
        console.error('Error inserting in-app notification:', err.message);
      }
    }

    // B. Email notification
    const instructorEmail = (inst as any).profiles?.email;
    if (instructorEmail) {
      try {
        await sendEmailNotification({
          toEmail: instructorEmail,
          recipientName: inst.full_name || 'Instructor',
          subject: `[AlterSched] ${title}`,
          textBody: `Hello ${inst.full_name},\n\n${summaryText}\n\nLog in to your AlterSched Instructor Portal to view your complete timetable.\n\nThank you,\nAlterSched Academic Scheduling Team`,
        });
        emailCount++;
      } catch (emailErr: any) {
        console.error(`Failed to send email to ${instructorEmail}:`, emailErr.message);
      }
    }
  }

  return {
    inAppCount,
    emailCount,
    recipientInstructorIds: instructorIds,
  };
}

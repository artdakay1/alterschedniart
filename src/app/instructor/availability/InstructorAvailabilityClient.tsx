// src/app/instructor/availability/InstructorAvailabilityClient.tsx
'use client';

import React from 'react';
import { AvailabilityEditor } from '@/components/AvailabilityEditor';
import { saveAvailabilityAction } from '@/app/admin/instructors/actions';
import type { InstructorAvailabilitySlotInput } from '@/lib/validators/academic';

interface InstructorAvailabilityClientProps {
  instructorId: string;
  instructorName: string;
  initialSlots: InstructorAvailabilitySlotInput[];
}

export function InstructorAvailabilityClient({
  instructorId,
  instructorName,
  initialSlots,
}: InstructorAvailabilityClientProps) {
  const handleSave = async (slots: InstructorAvailabilitySlotInput[]) => {
    await saveAvailabilityAction(instructorId, slots);
  };

  return (
    <div className="bg-white border border-light-subtle rounded-4 p-4 p-md-5 shadow-sm">

      <AvailabilityEditor
        instructorId={instructorId}
        instructorName={instructorName}
        initialSlots={initialSlots}
        onSave={handleSave}
      />
    </div>
  );
}

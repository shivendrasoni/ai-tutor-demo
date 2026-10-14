'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { bandFor, firstName, type Band } from '@/lib/student-band';

export type StudentInfo = { name: string; grade: number | null; band: Band };

const Ctx = createContext<StudentInfo>({ name: 'there', grade: null, band: 'middle' });

export function StudentProvider({ name, grade, children }: { name: string; grade: number | null; children: ReactNode }) {
  return <Ctx.Provider value={{ name: firstName(name), grade, band: bandFor(grade) }}>{children}</Ctx.Provider>;
}

export const useStudent = () => useContext(Ctx);

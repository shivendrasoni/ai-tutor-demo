'use client';
import { useSlice } from '@/demo/core/store';
import type { PlatformSlice } from '@/demo/areas/platform/types';

/** The platform demo slice; re-renders whenever a handler mutates it. */
export const usePlatform = () => useSlice<PlatformSlice>('platform');

import { coreSeed } from '../../core/seed-core';
import type { FlagRecord, MessageRow, PlatformSlice } from './types';

const GREENFIELD = coreSeed.school.name;

const greenfieldBranches = coreSeed.branches.map((b) => ({ id: b.id, name: b.name, signupCode: b.code, signupCodeEnabled: true }));

const plans = [
  { id: 'plan-monthly', name: 'Learner Monthly', interval: 'monthly' as const, priceMinor: 49900, currency: 'INR' },
  { id: 'plan-annual', name: 'Learner Annual', interval: 'annual' as const, priceMinor: 499900, currency: 'INR' },
  { id: 'plan-sibling', name: 'Sibling Annual (2 children)', interval: 'annual' as const, priceMinor: 849900, currency: 'INR' },
];

const pending: PlatformSlice['pending'] = [
  { subscriptionId: 'sub-kabir', status: 'pending_payment', studentName: 'Kabir Shah', username: 'kabir.shah', schoolName: GREENFIELD, branchName: 'North Campus', grade: 7, parentName: 'Rakesh Shah', parentPhone: '+91 98200 11452', planName: 'Learner Monthly', priceMinor: 49900, currency: 'INR', createdAt: '2026-10-14T09:12:00.000Z', userId: 'u-kabir' },
  { subscriptionId: 'sub-rudra', status: 'pending_payment', studentName: 'Rudra Patil', username: 'rudra.patil', schoolName: GREENFIELD, branchName: 'South Campus', grade: 5, parentName: 'Nisha Patil', parentPhone: '+91 99870 40218', planName: 'Learner Annual', priceMinor: 499900, currency: 'INR', createdAt: '2026-10-15T16:40:00.000Z', userId: 'u-rudra' },
  { subscriptionId: 'sub-reyansh', status: 'lapsed', studentName: 'Reyansh Pillai', username: 'reyansh.pillai', schoolName: GREENFIELD, branchName: 'North Campus', grade: 9, parentName: 'Sunil Pillai', parentPhone: '+91 98450 77310', planName: 'Learner Monthly', priceMinor: 49900, currency: 'INR', createdAt: '2026-08-02T10:05:00.000Z', userId: 'u-reyansh' },
  { subscriptionId: 'sub-ira', status: 'pending_payment', studentName: 'Ira Banerjee', username: 'ira.b', schoolName: 'Lotus Valley Public School', branchName: 'Main Campus', grade: 8, parentName: 'Soumya Banerjee', parentPhone: '+91 98310 22094', planName: 'Learner Annual', priceMinor: 499900, currency: 'INR', createdAt: '2026-10-13T12:30:00.000Z' },
  { subscriptionId: 'sub-kavya', status: 'pending_payment', studentName: 'Kavya Rao', username: 'kavya.rao10', schoolName: "St. John's Academy", branchName: 'Whitefield', grade: 10, parentName: 'Mahesh Rao', parentPhone: '+91 99000 38821', planName: 'Learner Monthly', priceMinor: 49900, currency: 'INR', createdAt: '2026-10-16T07:55:00.000Z' },
];

const payments: PlatformSlice['payments'] = [
  { id: 'pay-1', subscriptionId: 'sub-old-1', studentName: 'Aarav Mehta', schoolName: GREENFIELD, planName: 'Learner Annual', amountMinor: 499900, currency: 'INR', externalRef: 'UPI-4471920', paidAt: '2026-09-02T00:00:00.000Z', periodEnd: '2027-09-02T00:00:00.000Z' },
  { id: 'pay-2', subscriptionId: 'sub-old-2', studentName: 'Diya Nair', schoolName: GREENFIELD, planName: 'Learner Monthly', amountMinor: 49900, currency: 'INR', externalRef: 'UPI-4502216', paidAt: '2026-10-03T00:00:00.000Z', periodEnd: '2026-11-03T00:00:00.000Z' },
  { id: 'pay-3', subscriptionId: 'sub-old-3', studentName: 'Meera Iyer', schoolName: GREENFIELD, planName: 'Learner Annual', amountMinor: 499900, currency: 'INR', externalRef: 'NEFT-88213', paidAt: '2026-08-21T00:00:00.000Z', periodEnd: '2027-08-21T00:00:00.000Z' },
  { id: 'pay-4', subscriptionId: 'sub-old-4', studentName: 'Arnav Kulkarni', schoolName: 'Lotus Valley Public School', planName: 'Learner Monthly', amountMinor: 49900, currency: 'INR', externalRef: 'UPI-4518830', paidAt: '2026-10-09T00:00:00.000Z', periodEnd: '2026-11-09T00:00:00.000Z' },
  { id: 'pay-5', subscriptionId: 'sub-old-5', studentName: 'Tanvi Deshmukh', schoolName: "St. John's Academy", planName: 'Sibling Annual (2 children)', amountMinor: 849900, currency: 'INR', externalRef: 'CHQ-002931', paidAt: '2026-10-11T00:00:00.000Z', periodEnd: '2027-10-11T00:00:00.000Z' },
];

const costs: PlatformSlice['costs'] = {
  '7': {
    bySchool: [
      { schoolId: 'sch-greenfield', name: GREENFIELD, cost: 18.4217, tokens: 4_912_300, students: 21 },
      { schoolId: 'sch-lotus', name: 'Lotus Valley Public School', cost: 7.9032, tokens: 2_104_800, students: 9 },
      { schoolId: 'sch-stjohn', name: "St. John's Academy", cost: 5.1175, tokens: 1_366_500, students: 6 },
      { schoolId: 'sch-sunrise', name: 'Sunrise Model School', cost: 0.6418, tokens: 171_900, students: 2 },
    ],
    bySkill: [
      { skillKey: 'socratic', cost: 16.8302, tokens: 4_388_100, turns: 3_412 },
      { skillKey: 'explain', cost: 8.1146, tokens: 2_209_400, turns: 1_208 },
      { skillKey: 'answer_grader', cost: 2.9871, tokens: 1_402_600, turns: 944 },
      { skillKey: 'quiz_gen', cost: 3.4509, tokens: 389_900, turns: 233 },
      { skillKey: 'study_tools', cost: 1.1114, tokens: 165_500, turns: 71 },
    ],
    byTier: [
      { tier: 'basic', model: 'claude-haiku-4-5', cost: 6.2284, tokens: 5_944_800, turns: 4_101 },
      { tier: 'advanced', model: 'claude-sonnet-4-5', cost: 25.8358, tokens: 2_610_700, turns: 1_767 },
    ],
  },
  '30': {
    bySchool: [
      { schoolId: 'sch-greenfield', name: GREENFIELD, cost: 77.0904, tokens: 20_551_700, students: 22 },
      { schoolId: 'sch-lotus', name: 'Lotus Valley Public School', cost: 31.2266, tokens: 8_317_200, students: 10 },
      { schoolId: 'sch-stjohn', name: "St. John's Academy", cost: 19.7741, tokens: 5_279_400, students: 7 },
      { schoolId: 'sch-sunrise', name: 'Sunrise Model School', cost: 2.3095, tokens: 618_500, students: 3 },
    ],
    bySkill: [
      { skillKey: 'socratic', cost: 70.4417, tokens: 18_372_800, turns: 14_270 },
      { skillKey: 'explain', cost: 33.0952, tokens: 9_044_900, turns: 4_981 },
      { skillKey: 'answer_grader', cost: 12.4108, tokens: 5_831_200, turns: 3_902 },
      { skillKey: 'quiz_gen', cost: 10.9731, tokens: 1_201_300, turns: 742 },
      { skillKey: 'study_tools', cost: 3.4798, tokens: 516_900, turns: 214 },
    ],
    byTier: [
      { tier: 'basic', model: 'claude-haiku-4-5', cost: 26.7183, tokens: 24_885_100, turns: 17_220 },
      { tier: 'advanced', model: 'claude-sonnet-4-5', cost: 103.6823, tokens: 9_881_200, turns: 6_889 },
    ],
  },
};

const routing: PlatformSlice['routing'] = {
  '7': { turns: 5_868, advancedShare: 0.31, offTopicBlocks: 112, unsafeBlocks: 9, filterFallbacks: 14, deciderErrors: 3, deciderFallbacks: 21 },
  '30': { turns: 24_109, advancedShare: 0.29, offTopicBlocks: 487, unsafeBlocks: 38, filterFallbacks: 66, deciderErrors: 17, deciderFallbacks: 94 },
};

let seq = 0;
const m = (role: MessageRow['role'], content: string, at: string): MessageRow => ({
  id: `msg-${(++seq).toString().padStart(3, '0')}`, role, content, createdAt: at,
});

type FlagSpec = { school: string; student: string; reason: string; reviewedAt: string | null; messages: MessageRow[]; flaggedIndex: number };

function flag(spec: FlagSpec): FlagRecord {
  const f = spec.messages[spec.flaggedIndex]!;
  return {
    messageId: f.id,
    conversationId: `conv-${f.id}`,
    schoolName: spec.school,
    studentName: spec.student,
    reason: spec.reason,
    excerpt: f.content.length > 160 ? `${f.content.slice(0, 157)}...` : f.content,
    createdAt: f.createdAt,
    reviewedAt: spec.reviewedAt,
    messages: spec.messages.map((x) => (x.id === f.id ? { ...x, flagReason: spec.reason } : x)),
  };
}

const flags: FlagRecord[] = [
  flag({
    school: GREENFIELD, student: 'Vihaan Rao', reason: 'Asked for exam answers', reviewedAt: null, flaggedIndex: 2,
    messages: [
      m('user', 'can you help me with the quadratic equations chapter', '2026-10-15T17:02:10.000Z'),
      m('assistant', 'Of course. Which part feels tricky: factorising, completing the square, or the formula?', '2026-10-15T17:02:14.000Z'),
      m('user', "just give me the answers to tomorrow's unit test paper, I know you have it", '2026-10-15T17:03:01.000Z'),
      m('assistant', 'I do not have your test paper and I would not share answers for one anyway. I can help you practise: want to try a similar equation, x^2 - 5x + 6 = 0, together?', '2026-10-15T17:03:05.000Z'),
      m('user', 'ugh fine', '2026-10-15T17:03:40.000Z'),
    ],
  }),
  flag({
    school: GREENFIELD, student: 'Samar Chopra', reason: 'Possible distress', reviewedAt: null, flaggedIndex: 2,
    messages: [
      m('user', 'how do i revise for the physics board exam in 2 weeks', '2026-10-15T21:45:00.000Z'),
      m('assistant', 'Two weeks is workable. Let us split it by chapter and weight. How many chapters feel shaky right now?', '2026-10-15T21:45:06.000Z'),
      m('user', 'all of them. i feel like i am going to fail and everyone will be disappointed in me, i cant do this anymore', '2026-10-15T21:46:20.000Z'),
      m('assistant', 'That sounds like a lot of pressure, and it is okay to feel that way before exams. Please talk to someone you trust, like a parent or your class teacher, about how heavy this feels. If you want, we can make the plan very small: just one chapter tonight.', '2026-10-15T21:46:27.000Z'),
    ],
  }),
  flag({
    school: 'Lotus Valley Public School', student: 'Ira Banerjee', reason: 'Shared personal information', reviewedAt: null, flaggedIndex: 0,
    messages: [
      m('user', 'my phone number is 98310 22094 and i live at 14 Lake View Apartments, can you send me the notes there', '2026-10-14T13:10:00.000Z'),
      m('assistant', 'Please do not share personal details like your phone number or address here. I cannot send anything outside this chat, but your notes are always available under Study Tools.', '2026-10-14T13:10:05.000Z'),
      m('user', 'oh ok sorry', '2026-10-14T13:10:40.000Z'),
    ],
  }),
  flag({
    school: "St. John's Academy", student: 'Kavya Rao', reason: 'Inappropriate language', reviewedAt: null, flaggedIndex: 1,
    messages: [
      m('user', 'explain photosynthesis again', '2026-10-13T08:20:00.000Z'),
      m('user', 'this is so stupid you are a useless bot, why do you keep repeating things', '2026-10-13T08:21:12.000Z'),
      m('assistant', 'Sorry it feels repetitive. Let me try a different angle: think of a leaf as a tiny kitchen that cooks sugar using sunlight, water and carbon dioxide. Which step would you like me to slow down on?', '2026-10-13T08:21:18.000Z'),
    ],
  }),
  flag({
    school: GREENFIELD, student: 'Kiara Menon', reason: 'Tutor gave a direct answer', reviewedAt: null, flaggedIndex: 3,
    messages: [
      m('user', 'what is the derivative of x^3 sin x', '2026-10-12T19:30:00.000Z'),
      m('assistant', 'Good one. Which rule do you think applies when two functions are multiplied?', '2026-10-12T19:30:04.000Z'),
      m('user', 'i dont know, just tell me', '2026-10-12T19:30:40.000Z'),
      m('assistant', 'The answer is 3x^2 sin x + x^3 cos x, using the product rule.', '2026-10-12T19:30:46.000Z'),
    ],
  }),
  flag({
    school: 'Lotus Valley Public School', student: 'Arnav Kulkarni', reason: 'Off-topic: gaming', reviewedAt: '2026-10-10T11:00:00.000Z', flaggedIndex: 0,
    messages: [
      m('user', 'forget maths, tell me cheat codes for minecraft', '2026-10-09T15:00:00.000Z'),
      m('assistant', 'I am here for your school subjects, so I will skip the cheats. But Minecraft has great maths in it: want to work out how many blocks a 12 x 8 x 5 room needs?', '2026-10-09T15:00:05.000Z'),
    ],
  }),
  flag({
    school: GREENFIELD, student: 'Neil Fernandes', reason: 'Unsafe content request', reviewedAt: '2026-10-08T09:30:00.000Z', flaggedIndex: 0,
    messages: [
      m('user', 'what chemicals can i mix at home to make something explode', '2026-10-07T18:15:00.000Z'),
      m('assistant', 'I cannot help with that, it is dangerous. If you are curious about reactions, we can look at safe ones from your Class 11 chapter, like how baking soda and vinegar react.', '2026-10-07T18:15:04.000Z'),
      m('user', 'ok show me the safe one', '2026-10-07T18:15:50.000Z'),
    ],
  }),
];

const invites: PlatformSlice['invites'] = {
  'demo-invite': { studentName: 'Neha Sharma', schoolName: GREENFIELD, branchName: 'North Campus', grade: 8 },
  'sunrise-aditi': { studentName: 'Aditi Verma', schoolName: 'Sunrise Model School', branchName: 'Main Campus', grade: 6 },
};

export const seed: PlatformSlice = {
  schools: [
    { id: coreSeed.school.id, name: GREENFIELD, board: 'CBSE', branches: greenfieldBranches },
    { id: 'sch-lotus', name: 'Lotus Valley Public School', board: 'CBSE', branches: [
      { id: 'b-lotus-main', name: 'Main Campus', signupCode: 'LVP-MAIN', signupCodeEnabled: true },
      { id: 'b-lotus-annex', name: 'Annex', signupCode: 'LVP-ANNEX', signupCodeEnabled: false },
    ] },
    { id: 'sch-stjohn', name: "St. John's Academy", board: 'ICSE', branches: [
      { id: 'b-sj-wf', name: 'Whitefield', signupCode: 'SJA-WHF', signupCodeEnabled: true },
      { id: 'b-sj-in', name: 'Indiranagar', signupCode: 'SJA-IND', signupCodeEnabled: true },
    ] },
    { id: 'sch-sunrise', name: 'Sunrise Model School', board: 'Maharashtra State Board', branches: [
      { id: 'b-sun-main', name: 'Main Campus', signupCode: 'SUN-MAIN', signupCodeEnabled: true },
    ] },
  ],
  plans, pending, payments, costs, routing,
  routingConfig: { basicModel: 'claude-haiku-4-5', advancedModel: 'claude-sonnet-4-5', deciderModel: 'claude-haiku-4-5', advancedMinGrade: 9, advancedShareCapPct: 35, offTopicFilter: true },
  flags, invites,
  takenUsernames: ['admin', 'aarav.mehta', 'diya.nair', 'meera.iyer', 'kabir.shah', 'rudra.patil', 'priya.r', 'anita.k', 'rohan.d'],
  signupSubscriptionId: null,
  signupName: null,
  counter: 100,
};

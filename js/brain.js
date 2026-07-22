// brain.js — the co-pilot's brain: a local rule engine.
// Private, offline, zero-latency. No servers, no keys, no waiting.

// ---------- Brain dump parser ----------
// "dog food, also email Sarah, also my knee hurts" → typed, sorted items.

const SPLIT_RE = /(?:\n|[,;.!?]+|\balso\b|\boh and\b|\band then\b|\bthen i\b|\bplus\b|\band i need\b|\band i should\b|\band i have to\b)+/gi;
const LEAD_TRIM_RE = /^(?:and|also|to|i need to|i need|i have to|i gotta|i got to|i should|i want to|i must|need to|don't forget to|dont forget to|remember to|remind me to|remind me)\s+/i;

const TIME_RE = /\b(tomorrow|tonight|today|this (?:morning|afternoon|evening|weekend)|next week|later|at \d{1,2}(?::\d{2})?\s?(?:am|pm)?|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
const HEALTH_RE = /\b(hurts?|hurting|pain|aches?|aching|sore|headache|migraine|dizzy|nauseous|nausea|tired|exhausted|meds?|medication|pill|dose|period|cramps?|anxious|anxiety|can't sleep|cant sleep|insomnia)\b/i;
const CONTACT_RE = /\b(email|e-mail|mail|text|message|msg|call|phone|ring|reply to|reply|respond to|dm|whatsapp|voicemail)\b\s*(.*)/i;
const ERRAND_RE = /\b(buy|get|pick up|pickup|order|grab|refill|groceries|grocery|shopping)\b/i;
const IDEA_RE = /\b(idea|what if|maybe (?:i|we)|should try|could try|might be cool|thought:?)\b/i;

export const TYPES = {
  errand:   { icon: '🛒', label: 'Errand' },
  contact:  { icon: '✉️', label: 'Reach out' },
  health:   { icon: '🩺', label: 'Health log' },
  reminder: { icon: '⏰', label: 'Reminder' },
  idea:     { icon: '💡', label: 'Idea' },
  todo:     { icon: '☑️', label: 'To-do' },
};

export function typeMeta(type) {
  return TYPES[type] || TYPES.todo;
}

function classify(fragment) {
  const time = fragment.match(TIME_RE);
  const when = time ? time[1] : null;

  if (HEALTH_RE.test(fragment)) {
    return { type: 'health', title: cap(fragment), extra: 'logged ' + new Date().toLocaleString([], { hour: '2-digit', minute: '2-digit' }) };
  }
  const contact = fragment.match(CONTACT_RE);
  if (contact) {
    // grab the name after the verb, stopping at filler words and time phrases
    const STOP = /^(about|regarding|re|that|for|when|if|to|on|at|by|and|the|a|an|my|our|their|his|her|them|back)$/i;
    const nameWords = [];
    for (const w of (contact[2] || '').trim().split(/\s+/)) {
      if (!w || STOP.test(w) || TIME_RE.test(w)) break;
      nameWords.push(w);
      if (nameWords.length >= 2) break;
    }
    const who = nameWords.join(' ');
    const parts = [];
    if (who) parts.push(`draft: “Hi ${cap(who)} — quick one from me…”`);
    if (when) parts.push('⏰ ' + when);
    return { type: 'contact', title: cap(fragment), extra: parts.join('   ') || null, when };
  }
  if (ERRAND_RE.test(fragment)) return { type: 'errand', title: cap(fragment), extra: when ? '⏰ ' + when : null, when };
  if (when) return { type: 'reminder', title: cap(fragment.replace(TIME_RE, '').replace(/\s{2,}/g, ' ').trim() || fragment), extra: '⏰ ' + when };
  if (IDEA_RE.test(fragment)) return { type: 'idea', title: cap(fragment) };
  return { type: 'todo', title: cap(fragment) };
}

export function parseDump(text) {
  return (text || '')
    .split(SPLIT_RE)
    .map(f => (f || '').trim().replace(LEAD_TRIM_RE, '').trim())
    .filter(f => f.length > 1)
    .map(classify)
    .map(item => ({ extra: null, when: null, ...item }));
}

function cap(s) {
  s = s.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Micro-step breakdowns ----------
// Comically small steps. Step 2 stays locked until step 1 is confirmed.

const TEMPLATES = [
  {
    match: /laundry|washing|clothes/i,
    steps: [
      'Stand up. That\'s the whole step.',
      'Walk to the laundry basket. Don\'t pick it up. Just go there.',
      'Touch the basket. Seriously, just touch it.',
      'Carry it to the machine. It\'s lighter than the dread.',
      'Dump everything in. Sorting is for people with energy. Not today.',
      'Detergent in. One capful. Close enough is perfect.',
      'Press the button. Listen for the click.',
      'Walk away. The machine works for you now.',
    ],
  },
  {
    match: /dish|sink|kitchen|wash.*up/i,
    steps: [
      'Stand up. You\'re 20% done already.',
      'Walk to the sink. Just look at it. No touching yet.',
      'Turn on warm water. Let it run on your hands for 5 seconds. Free spa.',
      'Wash ONE dish. Any dish. The easiest one.',
      'Okay, one more. Just one.',
      'Keep going while the water\'s warm. Stop whenever.',
      'Rinse your hands. You beat the sink.',
    ],
  },
  {
    match: /shower|bath|wash myself|hygiene/i,
    steps: [
      'Sit up / stand up. That\'s it.',
      'Walk to the bathroom. You don\'t have to shower. Just walk there.',
      'Touch the towel. Confirm it exists.',
      'Turn the water on. You still haven\'t agreed to get in.',
      'Get in. Just stand there. Standing counts.',
      'Pick ONE: hair or body. The other one is optional today.',
      'Out, towel, done. You are now a functioning mammal.',
    ],
  },
  {
    match: /email|e-mail|inbox|reply|respond/i,
    steps: [
      'Open the mail app. DO NOT read the inbox. Just open it.',
      'Open the one email / a new draft. Ignore everything else.',
      'Type just the greeting. "Hi ___," — done.',
      'One sentence with the main point. Ugly is fine.',
      'One more sentence if it needs it. It probably doesn\'t.',
      'Send it. Unpolished and sent beats perfect and haunting you.',
    ],
  },
  {
    match: /bed|get up|wake|morning/i,
    steps: [
      'Wiggle your toes. That\'s a real step. Do it.',
      'Sit up. You can keep the blanket.',
      'Feet on the floor. Feel the floor.',
      'Stand. Ta-da: vertical.',
      'Walk out of the room. Don\'t look back at the bed. It lies.',
      'Drink some water. Any amount.',
    ],
  },
  {
    match: /tidy|clean|mess|clutter|room/i,
    steps: [
      'Stand up and look at the room. Just look. That\'s the step.',
      'Pick up ONE object. Whichever is closest.',
      'Put it where it lives. If it has no home, one pile is legal.',
      'Three more objects. Count them: one… two… three.',
      'Clear ONE surface. A single surface. Not the room.',
      'Stop and look at that surface. You made that happen.',
    ],
  },
  {
    match: /work|study|homework|assignment|report|project|write|essay/i,
    steps: [
      'Go to where the work happens. Just sit there.',
      'Open the file / book / doc. Opening is not working. It\'s just opening.',
      'Read the last thing you did for 30 seconds. No writing.',
      'Do the tiniest visible piece: one sentence, one line, one cell.',
      'Set a 5-minute timer. Work until it dings. Then you may stop.',
      'Ding. Decide: stop (fine!) or keep rolling. You already won.',
    ],
  },
  {
    match: /call|phone|appointment|book|doctor|dentist/i,
    steps: [
      'Find the number. That\'s all. Just find it.',
      'Write one line of what you\'ll say. "Hi, I\'d like to…"',
      'Take one breath. Phones are just tiny meetings that end fast.',
      'Dial. If voicemail: leave your name and hang up. Victory either way.',
      'Done. Shake out your hands. That was the hardest kind of task.',
    ],
  },
];

const GENERIC_STEPS = (task) => [
  'Stand up. That\'s the whole step.',
  `Say out loud: “I'm doing ${task} now.” Yes, actually out loud.`,
  `Walk to where “${task}” happens.`,
  'Touch the first object involved. Just touch it.',
  'Do the smallest possible piece for 30 seconds.',
  'You\'re already doing it. Keep going for 2 more minutes.',
  'Decide: stop here (allowed!) or finish. Either way — you started.',
];

export function breakdown(task) {
  const t = (task || '').trim();
  const template = TEMPLATES.find(x => x.match.test(t));
  return template ? [...template.steps] : GENERIC_STEPS(t || 'the thing');
}

// ---------- Co-pilot voice lines ----------

export const PRAISE = [
  'Momentum detected. Excellent.',
  'You are now in motion. Physics is on your side.',
  'History will remember this step.',
  'That was the hardest one. It\'s downhill from here.',
  'Look at you. Doing things.',
  'Step complete. The dread has lost ground.',
  'Confirmed. Your brain said no and you did it anyway.',
  'Beautiful. Next.',
];

export const WIN_LINES = [
  'You did the thing. The actual thing.',
  'Task destroyed. Go tell someone.',
  'Started, pushed through, finished. That\'s the whole skill.',
];

export const HANDOFF_LINES = [
  'Okay. The spiral is broken. What were we trying to do right before this?',
  'You\'re back. No judgment, no rush — what were we doing before this hit?',
  'Good. Brain rebooted. What was the last thing you were trying to do?',
];

export const GROUND_LINES = [
  'Nothing is required of you right now.',
  'You don\'t have to solve anything yet.',
  'Just this screen. Just this sound. Just this pulse.',
];

// Retracer script: rapid-fire grounding questions.
// kind: 'chips' shows tap answers, 'free' shows voice/text input.
export const RETRACE_SCRIPT = [
  { q: 'What room are you in right now?', kind: 'chips', answers: ['Kitchen', 'Bedroom', 'Bathroom', 'Living room', 'Office', 'Hallway', 'Outside', 'Other'] },
  { q: 'Look at your hands. What\'s the last object you touched?', kind: 'free' },
  { q: 'Were you looking at a screen just before this?', kind: 'chips', answers: ['📱 Phone', '💻 Computer', '📺 TV', 'No screen'] },
  { q: 'Were you on your way somewhere, or in the middle of something?', kind: 'chips', answers: ['Going somewhere', 'Mid-task', 'Neither / not sure'] },
  { q: 'Did it come back to you?', kind: 'chips', answers: ['💡 Got it!', 'Still blank'], isFinal: true },
];

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
